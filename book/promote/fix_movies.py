"""
fix_movies.py - 録画済み動画のFastStart変換スクリプト

ブラウザで録画された Fragmented MP4 (fMP4) を、
再エンコード（画質劣化）なしで標準の Progressive MP4 (FastStart形式) に変換します。
"""

import os
import sys
import shutil
import subprocess
import struct
from pathlib import Path

def inspect_mp4(filepath):
    """MP4のトップレベルボックスと再生時間を取得する"""
    boxes = []
    duration_sec = None
    with open(filepath, "rb") as f:
        # ボックス構造の走査
        while True:
            header = f.read(8)
            if len(header) < 8:
                break
            size, btype = struct.unpack(">I4s", header)
            bname = btype.decode("latin1", errors="ignore")
            boxes.append(bname)
            if size == 1:
                large_size = struct.unpack(">Q", f.read(8))[0]
                f.seek(large_size - 16, 1)
            elif size == 0:
                break
            else:
                f.seek(size - 8, 1)

        # durationの取得 (moov -> mvhd)
        f.seek(0)
        data = f.read(65536)
        moov_idx = data.find(b"moov")
        if moov_idx != -1:
            mvhd_idx = data.find(b"mvhd", moov_idx)
            if mvhd_idx != -1:
                version = data[mvhd_idx + 4]
                if version == 0:
                    timescale, dur = struct.unpack(">II", data[mvhd_idx + 16 : mvhd_idx + 24])
                else:
                    timescale = struct.unpack(">I", data[mvhd_idx + 24 : mvhd_idx + 28])[0]
                    dur = struct.unpack(">Q", data[mvhd_idx + 28 : mvhd_idx + 36])[0]
                if timescale > 0:
                    duration_sec = dur / timescale

    is_fragmented = "moof" in boxes
    is_faststart = len(boxes) >= 2 and boxes[1] == "moov"
    return {
        "boxes": boxes,
        "is_fragmented": is_fragmented,
        "is_faststart": is_faststart,
        "duration_sec": duration_sec
    }

def fix_movie_file(filepath: Path, backup_dir: Path):
    print(f"\n--- 処理中: {filepath.name} ---")
    info_before = inspect_mp4(filepath)
    print(f"  変換前: Fragmented={info_before['is_fragmented']}, FastStart={info_before['is_faststart']}, 長さ={info_before['duration_sec']:.2f}秒")

    if not info_before["is_fragmented"] and info_before["is_faststart"]:
        print("  => すでにFastStart形式に変換済みです。スキップします。")
        return True

    # バックアップ先
    backup_file = backup_dir / filepath.name
    if not backup_file.exists():
        shutil.copy2(filepath, backup_file)
        print(f"  元のファイルを退避しました: {backup_file.name}")

    # 一時ファイルへ変換出力
    temp_output = filepath.with_name(f"_temp_{filepath.name}")
    cmd = [
        "ffmpeg", "-y",
        "-i", str(filepath),
        "-c", "copy",
        "-movflags", "+faststart",
        str(temp_output)
    ]

    try:
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    except Exception as e:
        print(f"  エラー: ffmpeg の実行に失敗しました: {e}")
        if temp_output.exists():
            temp_output.unlink()
        return False

    # 変換後ファイルの検証
    info_after = inspect_mp4(temp_output)
    if info_after["is_fragmented"] or not info_after["is_faststart"]:
        print("  エラー: 変換後のファイルがFastStart形式になっていません。")
        temp_output.unlink()
        return False

    print(f"  変換後: Fragmented={info_after['is_fragmented']}, FastStart={info_after['is_faststart']}, 長さ={info_after['duration_sec']:.2f}秒")

    # 元ファイルを置き換え
    temp_output.replace(filepath)
    print("  => 変換完了（FastStart形式）")
    return True

def main():
    base_dir = Path(__file__).resolve().parent
    movie_dir = base_dir / "movie"
    if not movie_dir.exists():
        print(f"エラー: {movie_dir} が見つかりません。")
        sys.exit(1)

    backup_dir = movie_dir / "_backup_original"
    backup_dir.mkdir(exist_ok=True)

    mp4_files = sorted(list(movie_dir.glob("*.mp4")))
    if not mp4_files:
        print("変換対象のMP4ファイルが見つかりません。")
        return

    print(f"=== {len(mp4_files)} 件の動画ファイルを変換します ===")
    success_count = 0
    for mp4_path in mp4_files:
        if mp4_path.name.startswith("_"):
            continue
        if fix_movie_file(mp4_path, backup_dir):
            success_count += 1

    print("\n==================================================")
    print(f"完了: {success_count}/{len(mp4_files)} 件の動画が正常に変換されました。")
    print(f"元ファイルのバックアップ: {backup_dir}")
    print("==================================================")

if __name__ == "__main__":
    main()
