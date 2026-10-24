"""
server.py - ショート動画レコーダー用 ローカルWebサーバー

録画された動画をFastStart形式に変換し、movie/ フォルダへ保存します。
マルチスレッド対応により、連続録画時も安定して動作します。
"""

import os
import sys
import shutil
import subprocess
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import urllib.parse
import json

BASE_DIR = Path(__file__).resolve().parent
MOVIE_DIR = BASE_DIR / "movie"
MOVIE_DIR.mkdir(exist_ok=True)

class RecorderRequestHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        if parsed_url.path == "/api/movies-status":
            try:
                files = [f for f in os.listdir(MOVIE_DIR) if f.endswith(".mp4") and not f.startswith("_")]
                self.send_json_response(200, {"success": True, "files": files})
            except Exception as e:
                self.send_json_response(500, {"success": False, "error": str(e)})
        else:
            super().do_GET()

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        if parsed_url.path == "/api/save-movie":
            self.handle_save_movie(parsed_url)
        else:
            self.send_error(404, "Endpoint not found")

    def handle_save_movie(self, parsed_url):
        temp_path = None
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length <= 0:
                self.send_json_response(400, {"success": False, "error": "No content received"})
                return

            # クエリパラメータからファイル名を取得
            query_params = urllib.parse.parse_qs(parsed_url.query)
            filename = query_params.get("filename", ["recorded.mp4"])[0]
            filename = os.path.basename(filename)
            if not filename.endswith(".mp4"):
                filename += ".mp4"

            # ボディ（動画バイナリ）をチャンク単位で書き込み
            temp_path = MOVIE_DIR / f"_temp_upload_{filename}"
            final_path = MOVIE_DIR / filename

            remaining = content_length
            chunk_size = 64 * 1024
            with open(temp_path, "wb") as f:
                while remaining > 0:
                    read_bytes = min(remaining, chunk_size)
                    chunk = self.rfile.read(read_bytes)
                    if not chunk:
                        break
                    f.write(chunk)
                    remaining -= len(chunk)

            # ffmpeg で FastStart MP4 に変換 (画質劣化なし・高速)
            cmd = [
                "ffmpeg", "-y",
                "-i", str(temp_path),
                "-c", "copy",
                "-movflags", "+faststart",
                str(final_path)
            ]
            res = subprocess.run(
                cmd,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=30
            )

            if temp_path.exists():
                temp_path.unlink()

            if res.returncode != 0:
                self.send_json_response(500, {"success": False, "error": "FFmpeg conversion failed"})
                return

            print(f"[保存完了] {final_path.name}")
            self.send_json_response(200, {
                "success": True,
                "filename": filename,
                "savedPath": f"movie/{filename}"
            })
        except Exception as e:
            if temp_path and temp_path.exists():
                try:
                    temp_path.unlink()
                except Exception:
                    pass
            print(f"[エラー] 保存処理に失敗しました: {e}", file=sys.stderr)
            self.send_json_response(500, {"success": False, "error": str(e)})

    def send_json_response(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

def run(port=8000):
    server_address = ("", port)
    httpd = ThreadingHTTPServer(server_address, RecorderRequestHandler)
    httpd.daemon_threads = True
    print("================================================================")
    print(f" サーバー起動: http://localhost:{port}/recorder/index.html")
    print(f" 録画動画は自動で FastStart 形式に変換され、movie/ に保存されます。")
    print("================================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nサーバーを停止しました。")

if __name__ == "__main__":
    port = 8000
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
    run(port)
