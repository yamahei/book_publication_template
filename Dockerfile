FROM pandoc/latex:latest

# 1. 日本語フォント（IPAフォント、Noto CJK）のインストール
RUN apk --no-cache add \
    font-ipa \
    font-ipaex \
    font-noto-cjk \
    python3 \
    ffmpeg

# 2. TeX Live 日本語パッケージ群およびPandoc標準LaTeX要件パッケージのインストール
RUN tlmgr update --self && \
    tlmgr install \
      collection-langjapanese \
      collection-latexrecommended \
      luatexja \
      bxjscls \
      zxjafont \
      ipaex \
      xkeyval \
      etoolbox \
      selnolig
