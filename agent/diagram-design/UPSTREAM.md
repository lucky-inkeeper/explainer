# Upstream

Ported from https://github.com/cathrynlavery/diagram-design (MIT, Copyright (c) 2025 Cathryn Lavery).

- Upstream commit: ac490fd1ac4b4014100f93e729cb4ad198700bd4 (plugin version 2.6.7), copied 2026-08-29.
- Taken: 16 type references, semantic-patterns.md, primitive-annotation.md, the routing table and philosophy from SKILL.md.
- Changed: every file is rewritten for the Excalidraw skeleton (see SKILL.md "Canvas mapping"). SVG snippets, HTML output rules, size presets, dark mode, fonts, numeric complexity budgets, color-by-type anti-patterns and example links are removed. Node colors follow ADR-0003 (color per kind), not the upstream ink + accent scheme.
- Not taken: onboarding, profiles, style-guide tokens, export, animation, draw.io and Mermaid importers, icons, sketchy and terminal primitives, doctor, scripts, the 23 other types.

To diff against upstream later: `git clone --depth 1 https://github.com/cathrynlavery/diagram-design` and compare `skills/diagram-design/references/<file>` with the same file here.
