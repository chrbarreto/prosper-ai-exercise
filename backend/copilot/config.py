import os

COPILOT_MODEL = os.getenv('COPILOT_MODEL', 'gpt-4o')
CALLER_MODEL = os.getenv('CALLER_MODEL', 'gpt-4o-mini')
JUDGE_MODEL = os.getenv('JUDGE_MODEL', 'gpt-4o-mini')
JUDGE_REVIEW_MODEL = os.getenv('JUDGE_REVIEW_MODEL', COPILOT_MODEL)
MAX_TURNS = int(os.getenv('SIM_MAX_TURNS', '8'))
MAX_RUNS = int(os.getenv('SIM_MAX_RUNS', '10'))
CONCURRENCY = int(os.getenv('SIM_CONCURRENCY', '5'))
PERSONAS = ['happy path', 'confused', 'rushed', 'off-topic', 'policy-breaker']
