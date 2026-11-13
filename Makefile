.PHONY: reproduce test validate llm

# Regenerate results/summary.md, figures and docs/data from saved outputs.
reproduce:
	PYTHONPATH=src .venv/bin/python -m queuesim.analyze

# The simulation studies (cached in outputs/studies.json; slow first time).
validate:
	PYTHONPATH=src .venv/bin/python -m queuesim.validate

test:
	PYTHONPATH=src .venv/bin/python -m pytest tests/ -q
