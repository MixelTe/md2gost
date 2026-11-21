/** Protect destinations (including relative paths) and literal URLs before typography. */
export function protectLinkAddresses(text: string, protect: (value: string) => string): string
{
	let result = "";
	let from = 0;
	for (let i = 0; i < text.length - 1; i++)
	{
		if (text[i] != "]" || text[i + 1] != "(" || isEscaped(text, i)) continue;
		let depth = 1;
		let end = i + 2;
		for (; end < text.length; end++)
		{
			if (isEscaped(text, end)) continue;
			if (text[end] == "(") depth++;
			if (text[end] == ")" && --depth == 0) break;
		}
		if (depth != 0) continue;
		result += text.slice(from, i + 2) + protect(text.slice(i + 2, end));
		from = end;
		i = end;
	}
	result += text.slice(from);
	return result.replace(/\b(?:https?:\/\/|ftp:\/\/|mailto:|www\.)[^\s<>"`[\]*\uE000-\uF8FF]+/gi, value =>
	{
		let end = value.length;
		while (end > 0)
		{
			const last = value[end - 1]!;
			if (/[.,;:!?]/.test(last)) { end--; continue; }
			const open = last == ")" ? "(" : last == "]" ? "[" : last == "}" ? "{" : undefined;
			if (open && value.slice(0, end).split(last).length > value.slice(0, end).split(open).length) { end--; continue; }
			break;
		}
		return protect(value.slice(0, end)) + value.slice(end);
	});
}

export function isEscaped(text: string, index: number): boolean
{
	let slashes = 0;
	while (index > 0 && text[--index] == "\\") slashes++;
	return slashes % 2 == 1;
}

export function findClosingBackticks(text: string, from: number, count: number): number
{
	for (let i = from; i < text.length;)
	{
		const start = text.indexOf("`", i);
		if (start < 0) return -1;
		let end = start + 1;
		while (text[end] == "`") end++;
		if (end - start == count) return start;
		i = end;
	}
	return -1;
}

export function protectCodeSpans(text: string, protect: (value: string, start: number) => string): string
{
	let result = "";
	let from = 0;
	for (let i = 0; i < text.length;)
	{
		if (text[i] != "`" || isEscaped(text, i)) { i++; continue; }
		let end = i + 1;
		while (text[end] == "`") end++;
		const count = end - i;
		const close = findClosingBackticks(text, end, count);
		if (close < 0) { i = end; continue; }
		end = close + count;
		result += text.slice(from, i) + protect(text.slice(i, end), i);
		from = i = end;
	}
	return result + text.slice(from);
}

/** Apply an editor transformation only to prose, retaining inline code and addresses. */
export function transformProse(text: string, transform: (value: string) => string): string
{
	const literals: string[] = [];
	const protect = (value: string) => `\uE010${literals.push(value) - 1}\uE011`;
	text = protectCodeSpans(text, protect).replace(/\$[^\n$]+\$/g, match => protect(match));
	text = protectLinkAddresses(text, protect);
	return transform(text).replace(/\uE010(\d+)\uE011/g, (_, index: string) => literals[Number(index)]!);
}
