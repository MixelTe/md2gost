import * as vscode from "vscode";
import type MarkdownIt from "markdown-it";
import { type Token } from "markdown-it";
import { toCapitalCase, trimEnd, trimStart } from "./utils";
import { stringifyDict } from "./parser";

export function markdownItPlugin(md: MarkdownIt)
{
	function isGostyMd(env: any)
	{
		const config = vscode.workspace.getConfiguration("md2gost");
		const enhancedPreview = config.get<boolean>("ui.enhancedPreview", true);
		if (!enhancedPreview) return false;
		const uri = env.currentDocument ?? vscode.window.activeTextEditor?.document.uri as vscode.Uri | undefined;
		return !!(uri && uri?.fsPath?.endsWith(".g.md"));
	}

	md.core.ruler.after("inline", "md2gost_docs", function (state)
	{
		if (!isGostyMd(state.env))
			return true;
		const tokens = state.tokens;
		const re_doc = /^!!\(([^{}]*)\)\s*({(.*)})\s*$/s;
		const re_remTrailingComma = /,(\s*[}\]])/g;

		for (let i = 0; i < tokens.length; i++)
		{
			if (tokens[i].type != "inline") continue;
			const m = tokens[i].content.match(re_doc);
			if (!m) continue;

			const hasOpen = tokens[i - 1]?.type == "paragraph_open";
			const hasClose = tokens[i + 1]?.type == "paragraph_close";
			if (!hasOpen || !hasClose) continue;

			const json = m[2]!.replaceAll(re_remTrailingComma, "$1");
			let jsonParsed = {};
			try { jsonParsed = JSON.parse(json); }
			catch { continue; }

			const path = trimEnd(trimStart(m[1]!, "<", '"'), ">", '"');
			const dict = stringifyDict(jsonParsed);
			const isPdf = path.endsWith(".pdf");

			tokens[i - 1].type = "html_block";
			tokens[i - 1].content = `<div class="md2gost_doc ${isPdf ? "md2gost_doc_pdf" : ""}">`;

			tokens[i].type = "html_inline";

			tokens[i].content = /* html */`
			<div>${isPdf ? svg_pdf : svg_docx}</div>
			<div>${md.utils.escapeHtml(path)}</div>
			<div>
				${isPdf ? "" : Object.entries(dict).map(([k, v]) =>
				/* html */`<div>
				<span class="hljs-attr">${md.utils.escapeHtml(k)}</span>
				<span class="hljs-punctuation">${svg_arrow}</span>
				<span class="hljs-string">${md.utils.escapeHtml(v)}</span>
				</div>`.replaceAll(/\s+/g, " ").trim(),
				).join("")}
			</div>
			`.replaceAll(/\s+/g, " ").trim();
			tokens[i].children = [];

			tokens[i + 1].type = "html_block";
			tokens[i + 1].content = `</div>`;
		}
	});

	md.core.ruler.after("inline", "md2gost_sections", function (state)
	{
		if (!isGostyMd(state.env))
			return true;
		const regex = /^!!section(|\s+from\s+(\d+))\s*$/m;
		const tokens = state.tokens;

		for (let i = tokens.length - 1; i >= 0; i--)
		{
			if (tokens[i].type != "inline" || tokens[i].level != 1) continue;
			const inlineToken = tokens[i];
			const content = inlineToken.children?.map(t => t.type == "softbreak" ? "\n" : t.content).join("") || "";
			const match = regex.exec(content);
			if (!match) continue;
			const sectionValue = match[2] || "";

			const parts = content.split(match[0]);
			const textBefore = parts[0].replaceAll("\\n", " ").trim();
			const textAfter = parts.slice(1).join(match[0]).replaceAll("\\n", " ").trim();

			const newTokens = [];

			if (textBefore == "")
			{
				if (tokens[i - 1]?.type == "paragraph_open")
				{
					tokens.splice(i - 1, 1);
					i--;
				}
			}
			else
			{
				inlineToken.content = textBefore;
				const child = new state.Token("text", "", 0);
				child.content = textBefore;
				inlineToken.children = [child];
				newTokens.push(inlineToken);
				newTokens.push(new state.Token("paragraph_close", "p", -1));
			}

			const customToken = new state.Token("html_block", "", 0);
			const cls = sectionValue ? "" : "md2gost_section_nonumber";
			customToken.content = `<div class="md2gost_section ${cls}">${md.utils.escapeHtml(sectionValue)}</div>\n`;
			newTokens.push(customToken);

			if (textAfter != "")
			{
				newTokens.push(new state.Token("paragraph_open", "p", 1));
				const newInline = new state.Token("inline", "", 0);
				newInline.content = textAfter;
				const child = new state.Token("text", "", 0);
				child.content = textAfter;
				newInline.children = [child];
				newTokens.push(newInline);
			}
			else
			{
				if (tokens[i + 1]?.type == "paragraph_close")
					tokens.splice(i + 1, 1);
			}

			tokens.splice(i, 1, ...newTokens);
		}
	});

	md.core.ruler.after("inline", "md2gost_hide_rule_paragraphs", state =>
	{
		if (!isGostyMd(state.env))
			return true;
		state.tokens.forEach(blockToken =>
		{
			if (blockToken.type != "inline" || !blockToken.children) return;
			const children = blockToken.children;
			const newChildren = [];

			for (let i = 0; i < children.length; i++)
			{
				const token = children[i];

				if ((i == 0 || children[i - 1]?.type == "softbreak") && token.type == "text" && token.content.startsWith("!!rule "))
				{
					if (children[i + 1]?.type == "softbreak")
						i++;
					continue;
				}
				newChildren.push(token);
			}

			blockToken.children = newChildren;
			blockToken.content = newChildren.map(t => t.content).join("");
		});

		return true;
	});

	md.core.ruler.push("md2gost_generate_toc", state =>
	{
		if (!isGostyMd(state.env))
			return true;
		const tokens = state.tokens;
		const toc: { level: number; title: string; slug: string }[] = [];
		let tocIndex = -1;

		for (let i = 0; i < tokens.length; i++)
		{
			const token = tokens[i];
			if (token.type != "heading_open") continue;

			if (tocIndex < 0 && token.tag == "h1"
				&& tokens[i + 1]?.content.trim().toLowerCase() == "оглавление")
			{
				tocIndex = i;
				continue;
			}

			if (token.tag == "h1" && tokens[i + 1]?.content.trim().toLowerCase() == "реферат")
				continue;

			const level = parseInt(token.tag.slice(1), 10);
			const title = tokens[i + 1].content || "";
			const slug = title.toLowerCase().replace(/\s+/g, "-").replace(/[^\w\-a-яА-ЯеЁ]/g, "");

			toc.push({ level, title, slug });
		}

		if (tocIndex < 0 || toc.length == 0) return true;
		const tocTokens: Token[] = [];

		toc.forEach(item =>
		{
			const containerOpen = new state.Token("container_open", "div", 1);
			containerOpen.attrPush(["class", `md2gost_toc-entry`]);
			containerOpen.attrPush(["style", `padding-left: ${(item.level - 1) * 1.5}em`]);

			const linkOpen = new state.Token("link_open", "a", 1);
			linkOpen.attrPush(["href", `#${item.slug}`]);
			const text = new state.Token("text", "", 0);
			text.content = item.title;
			const linkClose = new state.Token("link_close", "a", -1);

			const dots = new state.Token("span_open", "span", 1);
			dots.attrPush(["class", "md2gost_toc-dots"]);
			const dotsClose = new state.Token("span_close", "span", -1);

			const pageOpen = new state.Token("span_open", "span", 1);
			const pageText = new state.Token("text", "", 0);
			pageText.content = "#";
			const pageClose = new state.Token("span_close", "span", -1);

			const containerClose = new state.Token("container_close", "div", -1);

			tocTokens.push(
				containerOpen,
				linkOpen, text, linkClose,
				dots, dotsClose,
				pageOpen, pageText, pageClose,
				containerClose,
			);
		});

		const wrapperOpen = new state.Token("container_open", "div", 1);
		const wrapperClose = new state.Token("container_close", "div", -1);
		wrapperOpen.attrPush(["class", "md2gost_toc"]);

		tokens.splice(tocIndex + 3, 0, wrapperOpen, ...tocTokens, wrapperClose);
		return true;
	});

	md.core.ruler.push("md2gost_enricher", state =>
	{
		if (!isGostyMd(state.env))
			return true;
		const tokens = state.tokens;

		for (let i = tokens.length - 1; i >= 0; i--)
		{
			const token = tokens[i];
			if (token.type != "heading_open" || token.tag != "h1") continue;
			const title = tokens[i + 1]?.content.trim().toLowerCase();
			if (title == "реферат")
			{
				insertParagraph(i + 3, "Отчет # с., # рис., # табл., # лист., # источн.");
			}
			else if (title == "термины и определения")
			{
				insertParagraph(i + 3, "В настоящем отчете применяются следующие термины с соответствующими определениями.");
				const listStart = i + 6;
				if (tokens[listStart].type != "bullet_list_open") continue;
				let _listEnd = findToken(listStart, "bullet_list_close");
				while (tokens[_listEnd + 1]?.type == "html_block" &&
					tokens[_listEnd + 2]?.type == "bullet_list_open" &&
					tokens[_listEnd + 1].content.trim().startsWith("<!--") &&
					tokens[_listEnd + 1].content.trim().endsWith("-->"))
					_listEnd = findToken(_listEnd + 1, "bullet_list_close");
				const listEnd = _listEnd;
				if (listEnd < 0) continue;
				const tableTokens: Token[] = [];

				tableTokens.push(new state.Token("table_open", "table", 1));
				tableTokens.push(new state.Token("thead_open", "thead", 1));
				tableTokens.push(new state.Token("tr_open", "tr", 1));
				["Термин", "Определение"].forEach(text =>
				{
					tableTokens.push(new state.Token("th_open", "th", 1));
					tableTokens.push(createTextToken(text));
					tableTokens.push(new state.Token("th_close", "th", -1));
				});
				tableTokens.push(new state.Token("thead_close", "thead", -1));

				tableTokens.push(new state.Token("tbody_open", "tbody", 1));
				tokens.slice(listStart, listEnd + 1).forEach(token =>
				{
					if (token.type != "inline") return;
					const parts = token.content.split(":");
					const term = parts[0]?.trim() || "";
					const definition = parts.slice(1).join(":").trim() || "";

					tableTokens.push(new state.Token("tr_open", "tr", 1));

					tableTokens.push(new state.Token("td_open", "td", 1));
					tableTokens.push(createTextToken(term));
					tableTokens.push(new state.Token("td_close", "td", -1));

					tableTokens.push(new state.Token("td_open", "td", 1));
					tableTokens.push(createTextToken(definition));
					tableTokens.push(new state.Token("td_close", "td", -1));

					tableTokens.push(new state.Token("tr_close", "tr", -1));
				});

				tableTokens.push(new state.Token("tbody_close", "tbody", -1));
				tableTokens.push(new state.Token("table_close", "table", -1));

				tokens.splice(listStart, listEnd - listStart + 1, ...tableTokens);
			}
			else if (title == "перечень сокращений и обозначений")
			{
				insertParagraph(i + 3, "В настоящем отчете применяют следующие сокращения и обозначения.");
			}
			else if (title == "список использованных источников")
			{
				i += 3;
				const startI = i;
				const listTokens: Token[] = [];
				listTokens.push(new state.Token("bullet_list_open", "ul", 1));
				while (true)
				{
					const token = tokens[i++];
					if (token?.type == "paragraph_open" || token?.type == "paragraph_close") continue;
					if (token?.type == "html_block" && token.content.trim().startsWith("<!--") && token.content.trim().endsWith("-->")) continue;
					if (token?.type != "inline") break;
					const content = token.children?.map(t => t.type == "softbreak" ? "\n" : t.content).join("") || "";
					const items = content.split(/\n\s*(?=\[[a-zA-Zа-яА-ЯёЁ_\d]+\])/);
					for (const item of items)
					{
						listTokens.push(new state.Token("list_item_open", "li", 1));
						listTokens.push(new state.Token("paragraph_open", "p", 1));
						listTokens.push(createTextToken(item));
						listTokens.push(new state.Token("paragraph_close", "p", -1));
						listTokens.push(new state.Token("list_item_close", "li", -1));
					}
				}
				while (i > startI && tokens[i]?.type != "paragraph_close") i--;
				listTokens.push(new state.Token("bullet_list_close", "ul", -1));
				if (listTokens.length > 2)
					tokens.splice(startI, i - startI + 1, ...listTokens);
				i = startI - 3;
			}

		}
		function insertParagraph(i: number, text: string)
		{
			tokens.splice(i, 0,
				new state.Token("paragraph_open", "p", 1),
				createTextToken(text),
				new state.Token("paragraph_close", "p", -1),
			);
		}
		function createTextToken(text: string)
		{
			const inline = new state.Token("inline", "", 0);
			inline.content = text;
			const child = new state.Token("text", "", 0);
			child.content = text;
			inline.children = [child];
			return inline;
		}
		function findToken(start: number, type: string)
		{
			for (let i = start; i < tokens.length; i++)
				if (tokens[i].type == type) return i;
			return -1;
		}

		return true;
	});

	md.core.ruler.after("inline", "md2gost_detect_rules", state =>
	{
		if (!isGostyMd(state.env))
			return true;
		const autoprefix = /^!!rule\s+numbering\s+autoprefix(|\s+on|\s+off)\s*$/im.exec(state.src);
		const lazy = /^!!rule\s+numbering\s+lazy(|\s+on|\s+off)\s*$/im.exec(state.src);
		const sections = /^!!rule\s+numbering\s+sections(|\s+on|\s+off)\s*$/im.exec(state.src);

		const settings = {
			md2gost_autoprefixDisable: (autoprefix?.[1] || "").trim().toLowerCase() == "off",
			md2gost_lazy: lazy && lazy[1].trim().toLowerCase() != "off",
			md2gost_sections: sections && sections[1].trim().toLowerCase() != "off",
		};

		state.tokens.forEach((token, i) =>
		{
			if (token.type == "inline")
				token.children?.forEach(child =>
				{
					if (child.type == "image")
						child.meta = { ...child.meta, ...settings };
				});
			if (token.type == "fence")
				token.meta = { ...token.meta, ...settings };
			if (token.type == "table_open")
			{
				if (state.tokens[i - 1]?.type == "paragraph_close" && state.tokens[i - 2]?.type == "inline")
				{
					const titleToken = state.tokens[i - 2];
					const tag = /^(.*?)\[([a-zA-Zа-яА-ЯёЁ_\d]+|#)\]/.exec(titleToken.content);
					if (!settings.md2gost_autoprefixDisable && (lazy || tag))
					{
						const text = titleToken.children?.find(t => t.type == "text");
						const title = addNumberToTitle(settings, "table", text?.content, false);
						if (title && text) text.content = title;
						titleToken.content = titleToken.children?.map(t => t.content).join("") || "";
						if (state.tokens[i - 3]?.type == "paragraph_open")
							state.tokens[i - 3].attrPush(["style", `margin-bottom: 0;`]);
					}
				}
			}
		});

		return true;
	});

	const defaultRender: MarkdownIt.Renderer.RenderRule = function (tokens, idx, options, env, self)
	{
		return self.renderToken(tokens, idx, options);
	};

	const defaultImageRender = md.renderer.rules.image || defaultRender;
	md.renderer.rules.image = (tokens, idx, options, env, self) =>
	{
		if (!isGostyMd(env))
			return defaultImageRender(tokens, idx, options, env, self);

		const token = tokens[idx];
		if (tokens[idx + 1]?.type == "text")
		{
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
		}

		const title = addNumberToTitle(token.meta, "image", token.content);
		const imageHtml = defaultImageRender(tokens, idx, options, env, self);

		return (
			`<figure style="margin-inline: 0; text-align: center;">` +
			imageHtml +
			(title ? `<figcaption>${title}</figcaption>` : "")
			+ `</figure>`
		);
	};

	const defaultFenceRender = md.renderer.rules.fence || defaultRender;
	md.renderer.rules.fence = (tokens, idx, options, env, self) =>
	{
		if (!isGostyMd(env))
			return defaultFenceRender(tokens, idx, options, env, self);

		const token = tokens[idx];
		const info = token.info ? token.info.trim() : "";
		const titleStart = info.indexOf(" ");
		const titleStr = titleStart >= 0 && info.slice(titleStart).trim();
		const title = addNumberToTitle(token.meta, "fence", titleStr);
		if (!title) return defaultFenceRender(tokens, idx, options, env, self);

		if (titleStart > 0) token.info = info.slice(0, titleStart);
		const code = defaultFenceRender(tokens, idx, options, env, self);
		return `<div><div>${title}</div>${code}</div>`;
	};

	function addNumberToTitle(meta: any, type: "image" | "fence" | "table", title: string | false | undefined, html = true)
	{
		const {
			md2gost_autoprefixDisable: autoprefixDisable,
			md2gost_lazy: lazy,
			md2gost_sections: sections,
		} = meta || {};

		if (!title || autoprefixDisable) return false;
		title = title || "";
		if (!title.trim()) return false;

		title = title.trimStart();
		if (html) title = md.utils.escapeHtml(title);
		title = title
			.replaceAll("\\n", "<br>")
			.replaceAll(" - ", " – ");
		title = toCapitalCase(title);

		const tag = /^(.*?)\[([a-zA-Zа-яА-ЯёЁ_\d]+|#)\]/.exec(title);
		if (!autoprefixDisable && (lazy || tag))
		{
			let num = sections ? "#.#" : "#";
			const prefix = type == "fence" ? "Листинг " : type == "table" ? "Таблица " : "Рисунок ";
			if (tag)
			{
				if (tag[1].trim().toLowerCase() == prefix.trim().toLowerCase())
				{
					if (tag[2] != "#")
						num = html ? `<i>[${tag[2]}]</i>` : `[${tag[2]}]`;
					if (sections) num = "#." + num;
					title = title.slice(tag[0].length);
				}
				else if (!tag[1].trim())
				{
					if (tag[2] != "#")
						num = html ? `<i>[${tag[2]}]</i>` : `[${tag[2]}]`;
					title = title.slice(tag[0].length);
				}
			}
			title = title.trimStart();
			if (title[0] == "-" || title[0] == "–")
				title = title.slice(1).trimStart();
			title = toCapitalCase(title);
			title = prefix + num + " – " + title;
		}
		return title;
	}
}


const svg_docx = `<svg version="1.2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 421 572" width="0.736em" height="1em" fill="#235fb5"><path style="opacity:0.25;" d="m394.9 124l-83.5 0.3c-6.3-0.1-12.3-7.1-12.3-15.2l-0.2-80.6"/><path  d="m29.4 520.3c9.2 4.2 11.3 3.2 24.1 3.7l15 0.5 0.1 10c0 10.9 1.4 15.2 6.2 20.1 6.4 6.3-3.7 5.9 133 6.2 81.7 0.1 125.7-0.1 128.1-0.8 5.9-1.6 10.3-5.1 13-10.5 2.2-4.1 2.7-6.6 2.9-15.1l0.4-10.2 15.1-0.4c14.8-0.3 15.4-0.4 21.8-3.5 11.7-5.8 20.7-17.7 22.9-30.3 0.5-3.3 0.8-78.2 0.7-184-0.2-149.8-0.4-178.9-1.6-181-1.6-3-98.6-100.6-108.4-109.1l-6.8-5.9h-127.7c-120.2 0.1-128 0.2-132.9 1.9-10.1 3.4-16.8 8.1-24 22-3.1 6-3.4 13.8-3.4 13.8l-0.5 222.1 0.1 221.9c0 9.1 7.3 22 21.9 28.6zm257.8-452.1c0.3 47.1 0.3 47.3 2.6 51.6 3.3 6.2 9.6 11.8 15.8 14.2 5.2 1.9 7.6 2 50.5 2h45l-0.3 176.7c-0.3 192.9 0.1 179.2-6.1 188-3.5 4.9-8.8 8.7-14.3 10.2-2.1 0.6-9.4 1.2-16.1 1.3l-12.2 0.3-0.3-25c-0.3-23.4-0.4-25.3-2.5-29-2.7-5-5.8-8-10.5-10-3.3-1.3-18.2-1.5-129.5-1.5h-125.8l-4 2.3c-2.2 1.2-5.4 4.3-7.1 6.9-2.8 4.1-3.3 5.9-3.9 13.8-0.4 5.1-0.6 16.6-0.4 25.7l0.4 16.5-13-0.1c-7.2-0.1-14.7-0.8-16.9-1.3-7.7-1.8-19.5-12.3-19.3-20.4l-0.1-3.8 0.3-220.1v-223l2.7-5c4.5-8.6 12.4-14.8 20.8-16.6 1.9-0.4 57.6-0.7 123.7-0.8l120.2-0.1zm59.8 8.3l47.5 47.5-42.5-0.2-42.5-0.3-3.3-2.3c-6.7-4.9-6.6-4.2-7.2-50.5-0.3-22.9-0.3-41.7 0-41.7 0.3 0 21.9 21.4 48 47.5zm-154.4 399.7c6 1.5 11.2 6.2 14.5 13.2 2.4 5.1 2.9 7.4 2.9 13.8 0 13.1-5.1 22.3-15 27.3-5.2 2.7-17.5 2.4-23.4-0.5-18.4-8.9-19.7-41.3-2-51.6 7-4.1 13.2-4.7 23-2.2zm60.6 0c6.9 2 12.3 8.1 14.3 16l0.7 2.8h-5.6c-5.5 0-5.6 0-7.6-4.1-2.6-5-7.4-7.3-13.1-6.4-8.7 1.5-12.4 8.4-11.7 21.5 0.4 6 1 8.8 2.5 10.8 6.4 8.8 19.4 7.7 23.3-1.9 1.2-2.7 1.6-2.9 6.8-2.9h5.5l-0.6 3.7c-0.9 5.5-5.5 11.3-11 14.2-6.6 3.3-17.3 3.4-24 0.2-9.4-4.6-14.7-14.1-14.7-26.6 0-15.4 7.7-25.8 21.3-28.5 4.4-0.8 7.7-0.6 13.9 1.2zm67.8 1.6c-0.6 0.9-4.4 6.9-8.5 13.2-4.1 6.3-7.5 11.9-7.5 12.5 0 0.5 3.8 6.8 8.5 14 4.7 7.2 8.5 13.4 8.5 13.8 0 0.4-2.8 0.7-6.2 0.5l-6.2-0.3-6.1-9.7c-3.3-5.4-6.2-9.8-6.5-9.8-0.3 0-3.2 4.4-6.5 9.8l-6.1 9.7-6.2 0.3c-3.4 0.2-6.2 0-6.2-0.3 0-0.3 0.8-1.8 1.9-3.3 5.9-8.5 15.4-23.8 15.4-24.7 0-1-2.5-5.1-12-19.7-2.3-3.7-4.3-6.9-4.3-7.2 0-0.4 2.8-0.6 6.3-0.6l6.2 0.1 4.7 7.7c7.9 13 6.6 12.8 13.3 1.9l5.9-9.6 5.5-0.3c6.8-0.4 7.4-0.2 6.1 2zm-183.4 1.7c3.8 2.4 5.6 4.5 8.1 9.4 2.9 5.6 3.3 7.2 3.3 14.4 0 12.5-4.6 20.8-14.1 25.8-3.9 2-6.2 2.4-19.1 2.7l-14.8 0.4v-28.2-28.2l15.8 0.4c15.7 0.3 15.9 0.3 20.8 3.3z"/><path  d="m77 142.9c0 0.5 1.4 6.3 3.1 12.8 1.7 6.5 6 23.3 9.6 37.3 3.6 14 7.3 28.4 8.2 32l1.7 6.5 8 0.3 8.1 0.3 2.5-9.8c1.4-5.4 5.2-20.3 8.4-33.1 3.1-12.8 6.1-22.9 6.4-22.5 0.4 0.5 3.7 12.9 7.4 27.8 3.7 14.8 7.4 29.4 8.2 32.2l1.6 5.3h7.8 7.9l1-3.8c0.5-2 3.7-14.3 7-27.2 5.7-22.6 13.4-52 14.7-56.8 0.6-2.1 0.4-2.2-7.2-2.2h-7.9l-5.2 22.2c-2.9 12.3-6.2 26.8-7.4 32.3-2.7 12.8-2.8 13-3.8 11.9-0.8-0.9-1.3-2.9-10.7-40.8-3.1-12.7-5.8-23.6-6.1-24.3-0.4-0.9-2.7-1.3-7.7-1.3h-7.1l-2.2 8.7c-1.2 4.9-4.7 19.1-7.8 31.8-3.1 12.6-5.9 23.9-6.4 25-1.1 2.5-2.2-1.4-8.6-30-2.6-11.6-5.5-24.2-6.4-28l-1.7-7-7.7-0.3c-4.5-0.2-7.7 0.1-7.7 0.7z"/><path  d="m82.5 283.4c-1.1 0.8-1.8 2.6-1.8 4.6 0 2 0.7 3.8 1.8 4.6 1.6 1.2 23.3 1.4 127.7 1.4 124.5 0 125.8 0 127.8-2 2.5-2.5 2.5-5.5 0-8-2-2-3.3-2-127.8-2-104.4 0-126.1 0.2-127.7 1.4z"/><path  d="m83.4 330.8c-1.3 0.8-3.4 4.6-3.4 6.1 0 0.6 0.9 2 2 3.1 2 2 3.3 2 128 2 124.7 0 126 0 128-2q3.9-3.9-0.3-7.8l-2.3-2.2h-125.5c-69 0-125.9 0.4-126.5 0.8z"/><path  d="m82.5 380.5c-2.9 2.8-3.1 4.2-0.9 7.3l1.5 2.2h77.8c74.1 0 77.9-0.1 79.4-1.8 2.3-2.5 2.1-5.8-0.3-8.2-2-2-3.3-2-78.5-2h-76.6z"/><path  d="m179.5 484.7c-4 1.1-7.4 4.4-9.1 9-3.6 9.4-1.3 22.1 4.8 26.4 4.3 3.1 11.4 3.6 15.5 1 5-3.1 7.3-8.7 7.3-17.6 0-11.9-4-17.9-12.7-18.9-2.1-0.3-4.7-0.2-5.8 0.1z"/><path  d="m112 503.5v18.7l7.9-0.3c9.2-0.5 12.4-2.2 15.6-8.5 2.7-5.4 2.7-15.6 0-20.3-3.5-5.9-6.7-7.5-15.6-8l-7.9-0.3z"/></svg>`;
const svg_pdf = `<svg version="1.2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 421 572" width="0.736em" height="1em" fill="#e23436"><path style="opacity:0.25;" d="m394.3 125.4l-81.8 0.3c-6.3-0.2-14.3-8-14.3-16.1v-81.8"/><path  d="m37.6 12.1c-13.9 3.3-26.7 17.5-29.6 32.9-0.6 3.4-1 81.2-1 223.9 0 213.8 0 218.8 2 225.4 1 3.8 3 8.8 4.4 11.1 3.5 6 11.7 13.3 18.4 16.4 5.2 2.4 7 2.6 21 3l15.2 0.4v8.8c0 14 3.6 21.5 12.4 25.6l5.1 2.4h123.5c84 0 124.7-0.4 127.3-1.1 3.9-1.1 10.9-6.6 13-10.3 0.6-1.2 1.4-7.3 1.7-13.6l0.5-11.5 15-0.5c18.2-0.7 23.2-2.3 32.2-10.4 4.4-4.1 6.8-7.3 9.4-12.8l3.4-7.3 0.3-182.6c0.1-100.5-0.1-183.6-0.5-184.7-0.7-1.9-96.7-99.1-109.5-110.9l-5.8-5.3-127.2 0.1c-73.3 0.1-129 0.5-131.2 1zm249.4 57.4c0.4 35.6 0.8 47.7 1.8 50 2.5 5.6 8.1 11.3 14 14.2l5.7 2.8 46 0.5 46 0.5-0.3 177c-0.4 175.1-0.4 177-2.4 181.7-2.4 5.5-9.2 12.2-15.1 14.8-3.4 1.5-6.9 1.9-16.7 2-6.9 0.1-13 0.1-13.7 0.1-0.9-0.1-1.3-6.8-1.5-26.5l-0.3-26.4-3.1-3.9c-1.7-2.1-4.8-4.8-7-6l-3.9-2.3h-126.3c-122.3 0-126.4 0.1-130 1.9-2 1.1-4.9 3.2-6.4 4.8-5.1 5.4-5.8 9.3-5.8 35v23.4l-14.2-0.3c-11.4-0.2-15.1-0.7-18-2.1-4.9-2.5-11.3-9.1-14.1-14.7l-2.2-4.5-0.3-220c-0.1-144.6 0.1-221.8 0.8-225.4 1.9-10.5 11.4-20.6 21.7-23 2.1-0.5 56.5-0.8 124.3-0.8l120.5 0.2zm59.3 7.3c25.7 25.8 46.7 47.1 46.7 47.5 0 1.2-80.5 0.8-83.7-0.4-3.5-1.3-7-4.5-9.1-8.4-1.5-2.6-1.7-8-1.9-44.3-0.1-22.6 0.2-41.2 0.5-41.2 0.4 0 21.8 21.1 47.5 46.8zm-177.3 402.5c9.7 5.1 12.2 20.4 4.7 28.5-4 4.3-7.8 5.7-17.2 6.2l-8.9 0.5-0.1 8.2c0 4.6-0.5 8.7-1.1 9.3-0.6 0.6-3.1 1-5.5 0.8l-4.4-0.3-0.3-27.8-0.2-27.7h14.3c13.1 0 14.8 0.2 18.7 2.3zm54.2 1c6.3 3.7 9.4 8 11.5 16 3.2 12.3-1.2 25.8-10.5 32-5.2 3.5-13.3 4.9-26.7 4.5l-10-0.3-0.3-27.8-0.2-27.9 15.7 0.4c15.2 0.3 16 0.4 20.5 3.1zm59.8 1.2v4.5h-13-13v7 7h11.4c11.1 0 11.5 0.1 11.8 2.2 0.2 1.3 0.1 3.5-0.1 5l-0.3 2.8h-11.4-11.3l-0.3 11.2-0.3 11.3-2.9 0.3c-1.5 0.2-3.9 0.1-5.2-0.2l-2.4-0.6v-27.5-27.5h18.5 18.5z"/><path  d="m157.5 114c-5 1.1-7.2 2.8-9.4 7.4-2.9 6-3.6 13.1-2.1 22.3 1.3 8.6 5.2 21.9 8 27.3l1.8 3.5-6.8 16.5c-3.7 9.1-9.6 22.8-13.2 30.4l-6.6 13.9-10.5 4.7c-18.2 8.1-32.5 19.1-35.6 27.3-2.6 6.8-0.4 14.5 4.9 17.2 4.1 2.1 12.3 1.9 16.8-0.4 8.9-4.5 20.8-18.5 28.7-33.8l3.7-7.2 6.7-1.9c18.9-5.6 46.2-12.2 50.7-12.2 1.4 0 4.8 1.7 7.7 3.9 19.7 14.6 43 18.6 51.3 8.8 2.7-3.2 3.3-10.6 1.3-15.1-4-8.7-21.9-12.9-43.6-10.4l-11.3 1.4-7.8-8.1c-9.6-9.8-15.1-17.2-20.9-28-4.3-8.2-4.3-8.3-2.9-12.2 6.5-16.6 8.9-39.1 4.9-46.8-3.7-7.1-9-9.9-15.8-8.5zm5.8 10.5c2.1 2 3 8.6 2.2 15.3-0.8 6.9-3.3 17.4-4.5 18.5-2.1 2.2-6.4-22.5-5-28.7 1.4-6.2 4.2-8.2 7.3-5.1zm3.2 69.7c4.1 6.7 12.7 17.7 16.9 21.7 1.4 1.4 2.6 2.8 2.6 3.2 0 0.4-3.5 1.4-7.7 2.4-4.3 0.9-13.6 3.2-20.7 5.1-7.1 1.9-13.1 3.3-13.3 3-0.2-0.2 1.6-4.6 4-9.7 2.4-5.2 6.4-14.5 8.8-20.6 2.4-6.2 4.7-11.3 5-11.3 0.3 0 2.3 2.8 4.4 6.2zm74 33.2c4.4 1.9 5.5 3.1 5.5 6.2 0 5.7-15 4.2-27.9-2.6-3.3-1.8-6.1-3.6-6.1-4.1 0-2.4 22.5-2 28.5 0.5zm-119.5 23.1c0 1.6-7.8 12.5-12.3 17.2-5.9 6.2-9.3 8.3-13.7 8.3-8.4 0 1.2-12.4 16.6-21.3 7.7-4.5 9.4-5.3 9.4-4.2z"/><path  d="m82 333.2c-2.5 2.8-2.6 5.2 0 7.8 2 2 3.3 2 127.8 2 99.1 0 126.2-0.3 127.4-1.3 2.7-2.1 3-5.2 0.7-8l-2-2.7h-125.9-125.9z"/><path  d="m82.2 381.3c-2.6 2.8-2.7 4.5-0.6 7.5l1.5 2.2h77.8c74.1 0 77.9-0.1 79.4-1.8 2.3-2.5 2.1-5.8-0.3-8.2-2-2-3.3-2-78.8-2h-76.9z"/><path  d="m147.4 488.2c0.3 1.3 0.6 5.6 0.6 9.7v7.4l7.3-0.6c6.1-0.5 7.5-1 9.5-3.2 3.4-4 2.6-10.9-1.7-14.2-0.9-0.7-4.8-1.3-9-1.3-7.1 0-7.3 0.1-6.7 2.2z"/><path  d="m199 504.5v18.5h6.8c8.7 0 12.9-2.1 16-8.1 2-3.7 2.3-5.5 1.9-11.4-0.7-12.7-5.7-17.5-18.2-17.5h-6.5z"/></svg>`;
const svg_arrow = `<svg version="1.2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 55 42" width="1em" height="0.7636em" stroke="currentColor" fill="none"><path style="stroke-linecap:round;stroke-linejoin:round;stroke-width:4;"  d="m48.4 21c0 0-40.8 0-42.8 0"/><path  style="stroke-linecap:round;stroke-linejoin:round;stroke-width:4;"  d="m31 3.9l18.5 17-18.5 16.9"/></svg>`;