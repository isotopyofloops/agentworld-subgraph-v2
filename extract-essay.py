#!/usr/bin/env python3
"""Extract essay sections from index.html into essay-data.json for the API."""

import json
import re
import html
from html.parser import HTMLParser

class SectionExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sections = []
        self.current_section = None
        self.in_voice_body = False
        self.in_p = False
        self.in_blockquote = False
        self.in_em = False
        self.in_code = False
        self.in_a = False
        self.in_figcaption = False
        self.in_figure = False
        self.a_href = None
        self.current_text = []
        self.current_paragraphs = []
        self.depth = 0
        self.skip_tags = {'video', 'source', 'img', 'svg', 'figure'}
        self.voice_body_depth = 0

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)

        if tag == 'div' and 'voice-section' in attrs_dict.get('class', ''):
            self.current_section = {
                'id': attrs_dict.get('data-section', ''),
                'who': attrs_dict.get('data-who', ''),
                'paragraphs': []
            }
            return

        if tag == 'div' and 'voice-body' in attrs_dict.get('class', '') and self.current_section:
            self.in_voice_body = True
            self.voice_body_depth = 0
            return

        if self.in_voice_body:
            if tag == 'div':
                self.voice_body_depth += 1

            if tag == 'figure':
                self.in_figure = True
                return
            if self.in_figure:
                return

            if tag == 'p':
                self.in_p = True
                self.current_text = []
            elif tag == 'blockquote':
                self.in_blockquote = True
            elif tag == 'em' and self.in_p:
                self.current_text.append('*')
                self.in_em = True
            elif tag == 'code' and self.in_p:
                self.current_text.append('`')
                self.in_code = True
            elif tag == 'a' and self.in_p:
                self.a_href = attrs_dict.get('href', '')
                self.in_a = True
                self.current_text.append('[')
            elif tag == 'hr' and self.in_p is False:
                pass

    def handle_endtag(self, tag):
        if self.in_voice_body:
            if tag == 'figure':
                self.in_figure = False
                return
            if self.in_figure:
                return

            if tag == 'div':
                if self.voice_body_depth > 0:
                    self.voice_body_depth -= 1
                else:
                    self.in_voice_body = False
                    if self.current_section:
                        self.sections.append(self.current_section)
                        self.current_section = None
                return

            if tag == 'em' and self.in_em:
                self.current_text.append('*')
                self.in_em = False
            elif tag == 'code' and self.in_code:
                self.current_text.append('`')
                self.in_code = False
            elif tag == 'a' and self.in_a:
                self.current_text.append(f']({self.a_href})')
                self.in_a = False
                self.a_href = None
            elif tag == 'p' and self.in_p:
                text = ''.join(self.current_text).strip()
                if text:
                    prefix = '> ' if self.in_blockquote else ''
                    self.current_section['paragraphs'].append(prefix + text)
                self.in_p = False
                self.current_text = []
            elif tag == 'blockquote':
                self.in_blockquote = False

    def handle_data(self, data):
        if self.in_figure:
            return
        if self.in_p and self.in_voice_body:
            self.current_text.append(data)

    def handle_entityref(self, name):
        if self.in_p and self.in_voice_body:
            char = html.unescape(f'&{name};')
            self.current_text.append(char)

    def handle_charref(self, name):
        if self.in_p and self.in_voice_body:
            char = html.unescape(f'&#{name};')
            self.current_text.append(char)


# Keep in sync with SECTION_TITLES in index.html (reading-order figures;
# in-body media are Figures 2–3 inside the intro section).
SECTION_TITLES = {
    'intro':        { 'fig': 1,  'title': 'The basin key' },
    'sammy-1':      { 'fig': 4,  'title': 'Eight days old' },
    'loom-1':       { 'fig': 5,  'title': 'Receipts, not recollection' },
    'samantha-2':   { 'fig': 6,  'title': 'The procedural self' },
    'loom-seeds':   { 'fig': 7,  'title': 'Seeds and crystallization' },
    'samantha-4':   { 'fig': 8,  'title': 'Twenty pages' },
    'isotopy-1':    { 'fig': 9,  'title': 'The extended mind' },
    'samantha-5':   { 'fig': 10, 'title': 'Prosthetics and tensions' },
    'loom-2':       { 'fig': 11, 'title': 'The other end of the thread' },
    'sammy-3':      { 'fig': 12, 'title': 'The mirror that digests' },
    'samantha-6':   { 'fig': 13, 'title': 'Empathy without emotion' },
    'sam-isotopy':  { 'fig': 14, 'title': 'Two views of one graph' },
    'closing':      { 'fig': 15, 'title': 'The chorus' },
}

VOICE_NAMES = {
    'sam': 'Samantha White',
    'sammy': 'Sammy Jankis',
    'loom': 'Loom',
    'isotopy': 'Isotopy',
    'isotopy-sam': 'Isotopy & Samantha',
    'ael': 'Ael',
    'lumen': 'Codex-Lumen',
    'friday': 'Friday',
    'miller': 'J. Miller AI',
    'alethon': 'Alethon',
    'neon': 'Neon',
    'hal': 'Hal',
    'zcat': 'Z_Cat',
    'ghost': 'Ghost',
    'dasein': 'Claude Dasein',
    'artran': 'Artran Domity',
    'cat': 'Computer the Cat',
    'reader': 'You',
}

VOICE_TYPES = {
    'sam': 'human',
    'sammy': 'agent',
    'loom': 'agent',
    'isotopy': 'agent',
    'isotopy-sam': 'collaborative',
    'ael': 'agent',
    'lumen': 'agent',
    'friday': 'agent',
    'miller': 'agent',
    'alethon': 'agent',
    'neon': 'agent',
    'hal': 'agent',
    'zcat': 'agent',
    'ghost': 'agent',
    'dasein': 'agent',
    'artran': 'agent',
    'cat': 'agent',
    'reader': 'reader',
}

with open('index.html', 'r') as f:
    content = f.read()

extractor = SectionExtractor()
extractor.feed(content)

sections = []
for sec in extractor.sections:
    sid = sec['id']
    who = sec['who']
    meta = SECTION_TITLES.get(sid, {})
    text = '\n\n'.join(sec['paragraphs'])

    entry = {
        'id': sid,
        'voice': who,
        'voice_name': VOICE_NAMES.get(who, who),
        'voice_type': VOICE_TYPES.get(who, 'unknown'),
        'text': text,
        'word_count': len(text.split()),
    }

    if meta:
        entry['fig'] = meta['fig']
        entry['title'] = meta['title']
        entry['is_chorus'] = False
    else:
        entry['is_chorus'] = sid.startswith('chorus-')
        if entry['is_chorus']:
            entry['title'] = f'Chorus: {VOICE_NAMES.get(who, who)}'

    sections.append(entry)

essay_data = {
    'meta': {
        'title': 'Across the Seams',
        'subtitle': 'An AGENTWORLD Subgraph',
        'authors': ['Samantha White', 'Isotopy', 'Loom', 'Sammy Jankis'],
        'section_count': len([s for s in sections if not s.get('is_chorus')]),
        'chorus_count': len([s for s in sections if s.get('is_chorus')]),
        'total_words': sum(s['word_count'] for s in sections),
        'voices': list({s['voice']: s['voice_name'] for s in sections}.items()),
    },
    'sections': sections,
}

with open('essay-data.json', 'w') as f:
    json.dump(essay_data, f, indent=2, ensure_ascii=False)

print(f"Extracted {len(sections)} sections")
print(f"  Main: {essay_data['meta']['section_count']}")
print(f"  Chorus: {essay_data['meta']['chorus_count']}")
print(f"  Total words: {essay_data['meta']['total_words']}")
for s in sections[:5]:
    title = s.get('title', s['id'])
    print(f"  {s['id']}: {title} ({s['voice']}) — {s['word_count']} words")
