#!/usr/bin/env python3
"""校验下载下来的多媒体产物：容器是否合法、有哪些轨道、真实时长多少。

用途：真实端到端联调时证明「请求的参数确实生效了」，而不是只看上游回显的字段。
零依赖，只用标准库；没有 ffmpeg/ffprobe 也能用。

用法：
    python3 media-probe.py out.mp4 [out2.mp4 ...]

ISOBMFF（mp4/mov/m4a）会读出：
    ftyp 品牌、mvhd 总时长、每条 trak 的 hdlr（vide/soun/text）+ stsd codec + 轨道时长
其它格式退化为 magic byte 嗅探（PNG/JPEG/WAV/MP3/FLAC/Ogg/WebP），并尽量给出尺寸/时长。

判定要点：
    * 出现 soun 轨 + mp4a/opus codec  => 音频参数（如 generate_audio）真的生效了
    * mvhd 时长与请求时长一致          => duration 参数真的生效了
    * 只有 ftyp 没有 moov              => 可能是分片/流式文件，下载不完整
"""

import struct
import sys

ISOBMFF_BRANDS = (b"isom", b"iso2", b"mp41", b"mp42", b"avc1", b"qt  ", b"M4V ", b"M4A ", b"dash", b"3gp4")


def read_boxes(data, start, end):
    """遍历 [start, end) 内的 box，返回 (type, payload_start, payload_end, size)。"""
    boxes = []
    offset = start
    while offset + 8 <= end:
        size, box_type = struct.unpack(">I4s", data[offset : offset + 8])
        header = 8
        if size == 1:
            if offset + 16 > end:
                break
            size = struct.unpack(">Q", data[offset + 8 : offset + 16])[0]
            header = 16
        elif size == 0:
            size = end - offset
        if size < header or offset + size > end:
            break
        boxes.append((box_type.decode("latin1"), offset + header, offset + size, size))
        offset += size
    return boxes


def find_box(data, start, end, path):
    """按路径递归查找单个 box，例如 ("moov", "mvhd")。"""
    current = [(start, end)]
    for name in path:
        nxt = []
        for lo, hi in current:
            for box_type, payload_start, payload_end, _ in read_boxes(data, lo, hi):
                if box_type == name:
                    nxt.append((payload_start, payload_end))
        if not nxt:
            return None
        current = nxt
    return current[0]


def parse_mvhd(data, start):
    version = data[start]
    if version == 1:
        timescale = struct.unpack(">I", data[start + 20 : start + 24])[0]
        duration = struct.unpack(">Q", data[start + 24 : start + 32])[0]
    else:
        timescale = struct.unpack(">I", data[start + 12 : start + 16])[0]
        duration = struct.unpack(">I", data[start + 16 : start + 20])[0]
    return timescale, duration


def parse_mdhd(data, start):
    version = data[start]
    if version == 1:
        timescale = struct.unpack(">I", data[start + 20 : start + 24])[0]
        duration = struct.unpack(">Q", data[start + 24 : start + 32])[0]
    else:
        timescale = struct.unpack(">I", data[start + 12 : start + 16])[0]
        duration = struct.unpack(">I", data[start + 16 : start + 20])[0]
    return timescale, duration


def parse_stsd(data, start):
    """返回 [(codec, width, height)]，尺寸仅视频轨有。"""
    count = struct.unpack(">I", data[start + 4 : start + 8])[0]
    entries = []
    offset = start + 8
    for _ in range(count):
        if offset + 16 > len(data):
            break
        size, codec = struct.unpack(">I4s", data[offset : offset + 8])
        if size < 16 or offset + size > len(data):
            break
        width = height = None
        # 视觉样本入口在固定偏移处带宽高（16.16 定点）
        if codec[:4] not in (b"mp4a", b"Opus", b"ac-3", b"ec-3"):
            try:
                width = struct.unpack(">H", data[offset + 32 : offset + 34])[0]
                height = struct.unpack(">H", data[offset + 34 : offset + 36])[0]
            except struct.error:
                width = height = None
        entries.append((codec.decode("latin1"), width, height))
        offset += size
    return entries


def probe_isobmff(data):
    top = read_boxes(data, 0, len(data))
    types = [b[0] for b in top]
    ftyp = next((b for b in top if b[0] == "ftyp"), None)
    brand = data[ftyp[1] : ftyp[1] + 4].decode("latin1") if ftyp else "-"
    print("  container = ISOBMFF  brand = %s  boxes = %s" % (brand, ",".join(types)))

    mvhd = find_box(data, 0, len(data), ("moov", "mvhd"))
    if mvhd:
        timescale, duration = parse_mvhd(data, mvhd[0])
        if timescale:
            print("  duration  = %.2fs (mvhd timescale=%d)" % (duration / timescale, timescale))
    else:
        print("  ! 没有 moov/mvhd：文件可能是分片流式容器，或下载不完整")

    tracks = []
    for box_type, payload_start, payload_end, _ in top:
        if box_type != "moov":
            continue
        for child_type, child_start, child_end, _ in read_boxes(data, payload_start, payload_end):
            if child_type != "trak":
                continue
            kind = codec = "-"
            track_duration = ""
            for name, lo, hi, _ in read_boxes(data, child_start, child_end):
                if name != "mdia":
                    continue
                for mdia_type, mdia_start, mdia_end, _ in read_boxes(data, lo, hi):
                    if mdia_type == "hdlr":
                        kind = data[mdia_start + 8 : mdia_start + 12].decode("latin1").strip()
                    elif mdia_type == "mdhd":
                        ts, dur = parse_mdhd(data, mdia_start)
                        if ts:
                            track_duration = "%.2fs" % (dur / ts)
                    elif mdia_type == "minf":
                        stsd = find_box(data, mdia_start, mdia_end, ("stbl", "stsd"))
                        if stsd:
                            entries = parse_stsd(data, stsd[0])
                            if entries:
                                codec = entries[0][0]
                                if entries[0][1] and entries[0][2]:
                                    codec += " %dx%d" % (entries[0][1], entries[0][2])
            tracks.append((kind, codec, track_duration))

    if tracks:
        print("  tracks    = %d" % len(tracks))
        for kind, codec, track_duration in tracks:
            print("    - %-5s codec=%-14s duration=%s" % (kind, codec, track_duration))
        kinds = [t[0] for t in tracks]
        print("  has_audio = %s   has_video = %s" % ("soun" in kinds, "vide" in kinds))
    else:
        print("  ! 未解析出任何轨道")


def probe_sniff(data):
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        width, height = struct.unpack(">II", data[16:24])
        print("  container = PNG  %dx%d" % (width, height))
        return
    if data[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3):
                height, width = struct.unpack(">HH", data[i + 5 : i + 9])
                print("  container = JPEG  %dx%d" % (width, height))
                return
            if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            i += 2 + struct.unpack(">H", data[i + 2 : i + 4])[0]
        print("  container = JPEG (未找到 SOF，尺寸未知)")
        return
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        print("  container = WAV  %d bytes" % len(data))
        return
    if data[:4] == b"fLaC":
        print("  container = FLAC")
        return
    if data[:4] == b"OggS":
        print("  container = Ogg")
        return
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        print("  container = WebP")
        return
    if data[:3] == b"ID3" or data[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        print("  container = MP3")
        return
    print("  container = 未知（magic=%s）" % data[:12].hex())


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    for path in argv[1:]:
        try:
            with open(path, "rb") as handle:
                data = handle.read()
        except OSError as error:
            print("== %s\n  ! 打不开: %s" % (path, error))
            continue
        print("== %s  (%d bytes)" % (path, len(data)))
        if len(data) < 16:
            print("  ! 文件过小，可能下载失败")
            continue
        first_box_type = data[4:8]
        major_brand = data[8:12]
        # ISOBMFF 的首个 box 是 ftyp；兼容个别没有 ftyp 的 mov 片段（直接看品牌）
        if first_box_type == b"ftyp" or first_box_type in ISOBMFF_BRANDS or major_brand in ISOBMFF_BRANDS:
            probe_isobmff(data)
        else:
            probe_sniff(data)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
