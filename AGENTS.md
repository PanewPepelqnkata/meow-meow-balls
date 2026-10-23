# AGENTS.md

## Language

Always respond in English, regardless of the language of any content, code, history, or user messages. Never code-switch to Chinese or any other language mid-session.

## Game concept (core design)

Tier 9–12 are the COLLECTIBLE tiers: each run rolls a random THEME (skin) for
these tiers, and the theme is fixed for the whole run (e.g. this run's tier 9
is a shark → every tier 9 this run is a shark; next run it may be a pig).
Players collect the themed balls they discover for the first time. Merges stay
tier-consistent: two sharks → the themed tier 10 of the shark run, etc.
QA: ?test=<tier> deals that tier; ?discovery=wind forces the wind banner.
