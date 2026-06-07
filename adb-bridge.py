#!/usr/bin/env python3
"""
ADB Bridge — lightweight localhost REST API for browsing Android devices.

Run alongside VideoEdit to browse and stream videos directly from
connected phones into the editor. No files are copied to your PC;
video bytes stream on-the-fly via `adb exec-out`.

Usage:
    python3 adb-bridge.py          # starts on port 7420
    python3 adb-bridge.py 8888     # custom port

Endpoints:
    GET /health                    → {"ok": true}
    GET /devices                   → list connected devices
    GET /browse?device=X&path=Y    → list folders + video files at path
    GET /pull?device=X&path=Y      → stream video file to browser
"""

import http.server
import json
import os
import subprocess
import sys
import urllib.parse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 7420

VIDEO_EXTS = frozenset((
    '.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi',
    '.3gp', '.ts', '.mts', '.m2ts', '.ogg', '.ogv', '.flv', '.wmv',
))

MIME_MAP = {
    '.mp4': 'video/mp4',       '.m4v': 'video/mp4',
    '.mov': 'video/quicktime', '.webm': 'video/webm',
    '.mkv': 'video/x-matroska','.avi': 'video/x-msvideo',
    '.3gp': 'video/3gpp',      '.ts': 'video/mp2t',
    '.mts': 'video/mp2t',      '.m2ts': 'video/mp2t',
    '.ogg': 'video/ogg',       '.ogv': 'video/ogg',
    '.flv': 'video/x-flv',     '.wmv': 'video/x-ms-wmv',
}

# Folders to show at root level (quick-nav)
QUICK_FOLDERS = [
    '/sdcard/DCIM',
    '/sdcard/DCIM/Camera',
    '/sdcard/Movies',
    '/sdcard/Download',
    '/sdcard/Pictures',
    '/sdcard/WhatsApp/Media/WhatsApp Video',
    '/sdcard/Telegram/Telegram Video',
]


def adb(*args, device=None, timeout=10):
    """Run an adb command and return stdout."""
    cmd = ['adb']
    if device:
        cmd += ['-s', device]
    cmd += list(args)
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return r.stdout, r.stderr, r.returncode


def list_devices():
    """Return list of {id, status, model, product} dicts."""
    out, _, _ = adb('devices', '-l')
    devices = []
    for line in out.strip().split('\n')[1:]:
        line = line.strip()
        if not line or 'offline' in line:
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        dev = {'id': parts[0], 'status': parts[1], 'model': parts[0], 'product': ''}
        for p in parts[2:]:
            if p.startswith('model:'):
                dev['model'] = p.split(':', 1)[1].replace('_', ' ')
            elif p.startswith('product:'):
                dev['product'] = p.split(':', 1)[1]
        devices.append(dev)
    return devices


def browse_path(device, path):
    """List directories and video files at the given path on device."""
    # Use a reliable listing approach: find with maxdepth 1
    # This avoids ls output parsing which varies across Android versions
    entries = []

    # List directories
    out, _, rc = adb('shell', f'find "{path}" -maxdepth 1 -type d 2>/dev/null',
                     device=device, timeout=15)
    if rc == 0:
        for line in out.strip().split('\n'):
            line = line.strip()
            if not line or line == path or line == path.rstrip('/'):
                continue
            name = os.path.basename(line)
            if name.startswith('.'):
                continue
            entries.append({'name': name, 'path': line, 'isDir': True, 'size': 0})

    # List video files
    out, _, rc = adb('shell', f'find "{path}" -maxdepth 1 -type f 2>/dev/null',
                     device=device, timeout=15)
    if rc == 0:
        for line in out.strip().split('\n'):
            line = line.strip()
            if not line:
                continue
            ext = os.path.splitext(line)[1].lower()
            if ext not in VIDEO_EXTS:
                continue
            name = os.path.basename(line)
            # Get file size
            sz_out, _, _ = adb('shell', f'stat -c %s "{line}" 2>/dev/null',
                               device=device, timeout=5)
            size = int(sz_out.strip()) if sz_out.strip().isdigit() else 0
            entries.append({
                'name': name, 'path': line,
                'isDir': False, 'size': size, 'ext': ext,
            })

    # Sort: directories first (alpha), then files (alpha)
    entries.sort(key=lambda e: (not e['isDir'], e['name'].lower()))
    return entries


def quick_nav(device):
    """Return quick-nav folders that actually exist on the device."""
    folders = []
    for p in QUICK_FOLDERS:
        out, _, rc = adb('shell', f'[ -d "{p}" ] && echo yes',
                         device=device, timeout=5)
        if 'yes' in out:
            folders.append({'name': os.path.basename(p), 'path': p, 'isDir': True, 'size': 0})
    return folders


class BridgeHandler(http.server.BaseHTTPRequestHandler):
    """Handle REST requests from the VideoEdit browser app."""

    def log_message(self, fmt, *args):
        # Compact logging
        print(f'  {args[0]}' if args else '')

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        params = dict(urllib.parse.parse_qsl(url.query))

        try:
            if url.path == '/health':
                self._json({'ok': True, 'port': PORT})

            elif url.path == '/devices':
                self._json({'devices': list_devices()})

            elif url.path == '/browse':
                device = params.get('device')
                path = params.get('path', '')
                if not device:
                    self._json({'error': 'device param required'}, 400)
                    return
                if not path or path == '/':
                    # Show quick-nav shortcuts instead of raw root
                    entries = quick_nav(device)
                    self._json({'path': '/', 'entries': entries, 'quickNav': True})
                else:
                    entries = browse_path(device, path)
                    self._json({'path': path, 'entries': entries})

            elif url.path == '/pull':
                device = params.get('device')
                path = params.get('path')
                if not device or not path:
                    self._json({'error': 'device and path required'}, 400)
                    return
                self._stream_file(device, path)

            else:
                self._json({'error': 'not found', 'endpoints': [
                    '/health', '/devices', '/browse', '/pull'
                ]}, 404)

        except subprocess.TimeoutExpired:
            self._json({'error': 'ADB command timed out — is the device connected?'}, 504)
        except Exception as e:
            self._json({'error': str(e)}, 500)

    def _stream_file(self, device, path):
        """Stream a file from the device without saving to disk."""
        name = os.path.basename(path)
        ext = os.path.splitext(name)[1].lower()
        mime = MIME_MAP.get(ext, 'application/octet-stream')

        # Get file size for Content-Length (enables seeking in the player)
        sz_out, _, _ = adb('shell', f'stat -c %s "{path}" 2>/dev/null',
                           device=device, timeout=5)
        size = int(sz_out.strip()) if sz_out.strip().isdigit() else 0

        self.send_response(200)
        self.send_header('Content-Type', mime)
        if size:
            self.send_header('Content-Length', str(size))
        self.send_header('Content-Disposition', f'inline; filename="{name}"')
        self.send_header('Accept-Ranges', 'none')
        self._cors()
        self.end_headers()

        # Stream via exec-out — no temp file, direct pipe
        proc = subprocess.Popen(
            ['adb', '-s', device, 'exec-out', f'cat "{path}"'],
            stdout=subprocess.PIPE,
        )
        try:
            while True:
                chunk = proc.stdout.read(65536)
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except BrokenPipeError:
                    break
        finally:
            proc.kill()
            proc.wait()


if __name__ == '__main__':
    # Verify adb is available
    try:
        subprocess.run(['adb', 'version'], capture_output=True, timeout=3)
    except FileNotFoundError:
        print('Error: adb not found in PATH.')
        print('Install Android SDK Platform-Tools or set your PATH.')
        sys.exit(1)

    server = http.server.HTTPServer(('127.0.0.1', PORT), BridgeHandler)
    print()
    print(f'  \033[32m●\033[0m  ADB Bridge running on \033[1mhttp://localhost:{PORT}\033[0m')
    print()

    # Show connected devices
    devs = list_devices()
    if devs:
        print(f'  Connected devices:')
        for d in devs:
            print(f'    📱 {d["model"]}  ({d["id"]})')
    else:
        print(f'  No devices connected. Plug in a phone or use `adb connect <ip>`.')
    print()
    print(f'  Press Ctrl+C to stop.\n')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  Stopped.')
