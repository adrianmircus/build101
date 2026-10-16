# build 101

Proyecto del equipo para [build 101](https://www.build101.dev/). Es un scaffold de Next.js, todavía sin código: arrancamos el sábado 17/10 después del kickoff.

- Roles y horarios: [`docs/PLAN.md`](docs/PLAN.md)
- Contexto del hackathon y reglas del equipo: [`CLAUDE.md`](CLAUDE.md)
- Agentes de Claude Code por rol: [`.claude/agents/`](.claude/agents/), con `frontend`, `backend` y `qa-demo`

## Arrancar
```bash
npm install
cp .env.example .env.local   # completar ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```
