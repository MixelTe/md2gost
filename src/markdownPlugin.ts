import MarkdownIt from "markdown-it";

export function markdownItPlugin(md: MarkdownIt)
{
	const defaultRender = md.renderer.rules.image || function (tokens, idx, options, env, self)
	{
		return self.renderToken(tokens, idx, options);
	};

	md.renderer.rules.image = (tokens, idx, options, env, self) =>
	{
		const token = tokens[idx];

		if (tokens[idx + 1]?.type != "text")
			return defaultRender(tokens, idx, options, env, self);

		const nextToken = tokens[idx + 1];
		const m = nextToken.content.match(/^\{(\d*)x?(\d*)\}/);
		if (m)
		{
			const width = m[1];
			const height = m[2];

			if (width)
				token.attrSet("width", width);
			if (height)
				token.attrSet("height", height);

			nextToken.content = nextToken.content.replace(m[0], "").trim();
		}

		return defaultRender(tokens, idx, options, env, self);
	};
}
