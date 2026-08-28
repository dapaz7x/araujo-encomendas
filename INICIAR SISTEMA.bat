@echo off
title Sistema de Encomendas - Araujo
set "PATH=C:\Users\reide\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;C:\Users\reide\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback;%PATH%"
start "" http://localhost:3000
pnpm dev
pause

