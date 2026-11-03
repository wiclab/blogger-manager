#!/usr/bin/env python3
"""Isolated Nobody Asked Data Bing batch submission runner.

The stable Byeolsemso indexing implementation is reused in a separate Python
process. This module changes ONLY the blog-specific constants before invoking
the existing two-phase prepare/submit logic. GitHub Actions uses an independent
data branch and concurrency group, so no Byeolsemso receipt is read or written.
"""
from __future__ import annotations

import sys

from scripts import indexing as core
from scripts import indexing_safe as safe

SITE = "https://qevnaxori.blogspot.com/"
HOST = "qevnaxori.blogspot.com"


def configure() -> None:
    """Pin all URL discovery, validation and Bing property checks to Nobody."""
    core.SITE = SITE
    core.HOST = HOST
    core.SITEMAP = SITE + "sitemap.xml"
    core.HEADERS = {"User-Agent": "NobodyAskedDataIndexingBot/1.0 (sitemap monitoring)"}


def main() -> int:
    configure()
    return safe.main()


if __name__ == "__main__":
    sys.exit(main())
