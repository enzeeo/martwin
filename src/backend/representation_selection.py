"""Select catalog representations with a model needs call and one batched representation call."""

import json
import os
from pathlib import Path
from urllib.request import Request, urlopen


PROMPTS = Path(__file__).with_name("prompts")
REQUEST_TIMEOUT_SECONDS = 20 * 60
DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free"


def _generate(messages, schema, *, timeout):
    token = os.environ.get("OPENROUTER_API_KEY")
    model = os.environ.get("OPENROUTER_MODEL") or DEFAULT_OPENROUTER_MODEL
    if not token:
        raise RuntimeError("Set OPENROUTER_API_KEY.")

    selection_tool = "representation_selection"
    use_tool = model == DEFAULT_OPENROUTER_MODEL
    payload = {
        "model": model,
        "provider": {"require_parameters": True},
        "messages": messages,
        "temperature": 0,
        "max_tokens": 8192 if "comparisons" in schema["properties"] else 2048,
    }
    if use_tool:
        payload["tools"] = [{
            "type": "function",
            "function": {
                "name": selection_tool,
                "description": "Submit the requested JSON object as this tool's arguments.",
                "parameters": schema,
            },
        }]
        payload["tool_choice"] = {"type": "function", "function": {"name": selection_tool}}
    else:
        payload["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": selection_tool, "strict": True, "schema": schema},
        }
    request = Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    with urlopen(request, timeout=timeout) as response:
        try:
            message = json.load(response)["choices"][0]["message"]
            if use_tool:
                for call in message.get("tool_calls") or []:
                    function = call["function"]
                    if function["name"] == selection_tool:
                        return function["arguments"]
                return None
            return message["content"]
        except (ValueError, KeyError, TypeError, IndexError, AttributeError):
            raise ValueError("Invalid OpenRouter response.") from None


def _validate(raw, properties):
    if not isinstance(raw, str):
        raise ValueError("Return a JSON object.")
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        raise ValueError("Return valid JSON without surrounding text.") from None
    if not isinstance(result, dict) or result.keys() != properties.keys():
        raise ValueError("Return exactly the required JSON keys.")

    if "needs" in result:
        needs = result["needs"]
        if not isinstance(needs, list) or len(needs) > 16 or any(
            not isinstance(need, str) or not need.strip() or len(need) > 400
            for need in needs
        ):
            raise ValueError("Return up to 16 nonempty needs of at most 400 characters each.")
    elif "comparisons" in result:
        for kind, families in result.items():
            expected = properties[kind]["properties"]
            if not isinstance(families, dict) or families.keys() != expected.keys():
                raise ValueError("Return exactly the requested families in each category.")
            for family_id, choice in families.items():
                _validate(json.dumps(choice), expected[family_id]["properties"])
    else:
        headers = result["headers"]
        allowed = properties["headers"]["items"]["enum"]
        if (
            not isinstance(headers, list)
            or not 1 <= len(headers) <= 3
            or any(not isinstance(header, str) or header not in allowed for header in headers)
            or len(set(headers)) != len(headers)
        ):
            raise ValueError("Return one to three unique exact headers from the menu.")
        reason = result["reason"]
        if not isinstance(reason, str) or not reason.strip() or len(reason) > 1199:
            raise ValueError("Return a nonempty reason of at most 1199 characters.")
    return result


def _ask(generate, prompt, data, properties):
    schema = {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }
    messages = [
        {"role": "system", "content": (PROMPTS / f"{prompt}.txt").read_text(encoding="utf-8")},
        {"role": "user", "content": json.dumps(data, ensure_ascii=False)},
    ]
    return _validate(generate(messages, schema), properties)


def choose_representations(
    objective: str,
    mars_latitude: float,
    mars_longitude: float,
    comparison_families: dict,
    filter_families: dict,
    *,
    generate=None,
) -> dict:
    """Return flattened catalog options and reasons, with separate comparison and filter lists."""
    result = {"comparisons": [], "filters": []}
    if not comparison_families and not filter_families:
        return result

    if generate is None:
        def generate(messages, schema):
            return _generate(messages, schema, timeout=REQUEST_TIMEOUT_SECONDS)
    context = {
        "objective": objective,
        "mars_target": {"latitude": mars_latitude, "longitude": mars_longitude},
    }
    needs = _ask(
        generate,
        "needs",
        {
            **context,
            "comparison_families": {
                fid: family["description"] for fid, family in comparison_families.items()
            },
            "earth_filter_families": {
                fid: family["description"] for fid, family in filter_families.items()
            },
        },
        {
            "needs": {
                "type": "array",
                "items": {"type": "string", "minLength": 1, "maxLength": 400},
                "maxItems": 16,
            },
        },
    )["needs"]

    menus = {}
    properties = {}
    categories = {"comparisons": comparison_families, "filters": filter_families}
    for key, families in categories.items():
        menus[key] = {}
        family_properties = {}
        for feature_id, family in families.items():
            menus[key][feature_id] = {
                "description": family["description"],
                "menu": [
                    {field: option[field] for field in
                     ("header", "stat", "meaning", "compare_mode", "caution")}
                    for option in family["options"]
                ],
            }
            family_properties[feature_id] = {
                "type": "object",
                "properties": {
                    "headers": {
                        "type": "array",
                        "items": {"type": "string", "enum": [
                            option["header"] for option in family["options"]
                        ]},
                        "minItems": 1,
                        "maxItems": 3,
                    },
                    "reason": {"type": "string", "minLength": 1, "maxLength": 1199},
                },
                "required": ["headers", "reason"],
                "additionalProperties": False,
            }
        properties[key] = {
            "type": "object", "properties": family_properties,
            "required": list(family_properties), "additionalProperties": False,
        }

    choices = _ask(generate, "representations", {**context, "needs": needs, **menus}, properties)
    for key, families in categories.items():
        for feature_id, family in families.items():
            options = {option["header"]: option for option in family["options"]}
            choice = choices[key][feature_id]
            result[key].extend(
                {**options[header], "feature_id": feature_id, "reason": choice["reason"]}
                for header in choice["headers"]
            )
    return result
