import json
import os
from openai import AsyncOpenAI

async def json_completion(model: str, system: str, content: dict, max_tokens=4000, schema=None) -> dict:
    async with AsyncOpenAI(api_key=os.environ.get('OPENAI_API_KEY'), timeout=60, max_retries=1) as client:
        if schema is not None:
            response = await client.beta.chat.completions.parse(
                model=model, temperature=0, max_tokens=max_tokens, response_format=schema,
                messages=[{'role':'system','content':system},{'role':'user','content':json.dumps(content)}])
            parsed = response.choices[0].message.parsed
            if parsed is None:
                raise ValueError('The model did not return an evaluation.')
            return parsed.model_dump()
        response = await client.chat.completions.create(
            model=model, temperature=0, max_tokens=max_tokens,
            response_format={'type': 'json_object'},
            messages=[{'role':'system','content':system}, {'role':'user','content':json.dumps(content)}],
        )
    if response.choices[0].finish_reason == 'length':
        raise ValueError('Model response was truncated. Try a more focused request.')
    return json.loads(response.choices[0].message.content or '{}')
