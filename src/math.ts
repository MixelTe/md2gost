// Special thanks to Codex for developing this module.
import { XmlComponent } from "docx";

class Omml extends XmlComponent
{
	constructor(tag: string, children: (XmlComponent | string)[] = [], attributes: Record<string, string> = {})
	{
		super(tag);
		if (Object.keys(attributes).length) this.root.push({ _attr: attributes });
		this.root.push(...children);
	}
}

const symbols: Record<string, string> = {
	alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "ϕ", chi: "χ", psi: "ψ", omega: "ω",
	Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
	cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓", ast: "∗", star: "⋆", circ: "∘", bullet: "∙",
	oplus: "⊕", ominus: "⊖", otimes: "⊗", oslash: "⊘", odot: "⊙", setminus: "∖", wedge: "∧", vee: "∨",
	le: "≤", leq: "≤", ge: "≥", geq: "≥", neq: "≠", ne: "≠", approx: "≈", equiv: "≡", sim: "∼", simeq: "≃", cong: "≅", propto: "∝", ll: "≪", gg: "≫",
	infty: "∞", partial: "∂", nabla: "∇", in: "∈", notin: "∉", ni: "∋", subset: "⊂", subseteq: "⊆", superset: "⊃", supseteq: "⊇", emptyset: "∅", varnothing: "∅", cup: "∪", cap: "∩",
	perp: "⊥", parallel: "∥", mid: "∣", angle: "∠", therefore: "∴", because: "∵",
	to: "→", rightarrow: "→", leftarrow: "←", leftrightarrow: "↔", mapsto: "↦", Rightarrow: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔", uparrow: "↑", downarrow: "↓", updownarrow: "↕",
	forall: "∀", exists: "∃", neg: "¬", land: "∧", lor: "∨",
	degree: "°", ell: "ℓ", prime: "′", hbar: "ℏ", aleph: "ℵ", Re: "ℜ", Im: "ℑ", ldots: "…", dots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱",
};
const operators: Record<string, string> = { sin: "sin", cos: "cos", tan: "tan", cot: "cot", sec: "sec", csc: "csc", log: "log", ln: "ln", exp: "exp", max: "max", min: "min", gcd: "gcd", det: "det" };

type MathStyle = "plain" | "bold" | "italic" | "double-struck" | "script";

function run(text: string, style?: MathStyle): XmlComponent
{
	const value = style == "plain" ? "p" : style == "bold" ? "b" : style == "italic" ? "i" : undefined;
	return new Omml("m:r", [
		...(style == "double-struck" || style == "script" ? [new Omml("m:rPr", [new Omml("m:scr", [], { "m:val": style }), new Omml("m:sty", [], { "m:val": "p" })])] : []),
		...(value ? [new Omml("m:rPr", [new Omml("m:sty", [], { "m:val": value })])] : []),
		new Omml("m:t", [text], { "xml:space": "preserve" }),
	]);
}
function arg(children: XmlComponent[]): XmlComponent { return new Omml("m:e", children); }
function delimiter(children: XmlComponent[], begin: string, end: string): XmlComponent
{
	return new Omml("m:d", [
		new Omml("m:dPr", [new Omml("m:begChr", [], { "m:val": begin }), new Omml("m:endChr", [], { "m:val": end })]),
		arg(children),
	]);
}

/**
 * A deliberately small, dependency-free LaTeX reader that emits Word's native
 * Office Math XML. The generated tree is also a presentation-math equivalent:
 * it retains fractions, scripts, radicals, n-ary operators and matrices rather
 * than flattening formulas into text.
 */
export function latexToOmml(latex: string, para = false): XmlComponent
{
	const parser = new LatexParser(latex);
	const body = parser.sequence();
	if (!parser.done()) throw new Error(`unexpected "${parser.peek()}"`);
	const math = new Omml("m:oMath", body);
	return para ? new Omml("m:oMathPara", [math]) : math;
}

class LatexParser
{
	private i = 0;
	constructor(private readonly source: string) { }
	done() { return this.i >= this.source.length; }
	peek() { return this.source[this.i] || ""; }
	private take() { return this.source[this.i++] || ""; }
	private skipWhitespace() { while (/\s/.test(this.peek())) this.take(); }
	private command(name: string) { return this.source.slice(this.i).startsWith(`\\${name}`) && !/[A-Za-z]/.test(this.source[this.i + name.length + 1] || ""); }
	sequence(stop?: string, style?: MathStyle, preserveWhitespace = false, boundary?: () => boolean): XmlComponent[]
	{
		const result: XmlComponent[] = [];
		while (!this.done() && this.peek() != stop && !boundary?.())
		{
			if (/\s/.test(this.peek()))
			{
				this.take();
				if (preserveWhitespace) result.push(run(" ", style));
				continue;
			}
			if (this.command("displaystyle") || this.command("textstyle"))
			{
				this.take(); while (/[A-Za-z]/.test(this.peek())) this.take();
				continue;
			}
			if (this.source.startsWith("\\!", this.i)) { this.i += 2; continue; }
			result.push(this.decoratedAtom(style, preserveWhitespace));
		}
		if (stop) { if (this.take() != stop) throw new Error(`missing "${stop}"`); }
		return result;
	}
	private decoratedAtom(style?: MathStyle, preserveWhitespace = false): XmlComponent
	{
		let value = this.atom(style, preserveWhitespace);
		let sub: XmlComponent[] | undefined;
		let sup: XmlComponent[] | undefined;
		while (true)
		{
			const beforeSpace = this.i;
			this.skipWhitespace();
			if (this.peek() != "_" && this.peek() != "^") { this.i = beforeSpace; break; }
			const marker = this.take(); const script = this.groupOrAtom(style);
			if (marker == "_" ? sub : sup) throw new Error("duplicate script");
			if (marker == "_") sub = script; else sup = script;
		}
		if (sub && sup) value = new Omml("m:sSubSup", [new Omml("m:e", [value]), new Omml("m:sub", sub), new Omml("m:sup", sup)]);
		else if (sub) value = new Omml("m:sSub", [new Omml("m:e", [value]), new Omml("m:sub", sub)]);
		else if (sup) value = new Omml("m:sSup", [new Omml("m:e", [value]), new Omml("m:sup", sup)]);
		return value;
	}
	private groupOrAtom(style?: MathStyle, preserveWhitespace = false): XmlComponent[]
	{
		this.skipWhitespace();
		if (this.done() || ["}", "_", "^", "&"].includes(this.peek())) throw new Error("argument expected");
		if (this.peek() == "{") { this.take(); return this.sequence("}", style, preserveWhitespace); }
		return [this.atom(style)];
	}
	private atom(style?: MathStyle, preserveWhitespace = false): XmlComponent
	{
		const ch = this.take();
		if (!ch || ["}", "_", "^", "&"].includes(ch)) throw new Error(`unexpected "${ch}"`);
		if (ch == "{") return new Omml("m:box", [arg(this.sequence("}", style, preserveWhitespace))]);
		if (ch != "\\") return run(ch, style);
		let name = "";
		while (/[A-Za-z]/.test(this.peek())) name += this.take();
		if (!name)
		{
			const escaped = this.take();
			if (!escaped) throw new Error("command expected");
			const spaces: Record<string, string> = { ",": "\u2009", ";": "\u2004", ":": "\u2005", " ": " " };
			if (spaces[escaped]) return run(spaces[escaped], style);
			// OMML has no direct negative-thin-space equivalent. Do not emit a
			// Unicode control character that Word may display as a missing glyph.
			if (escaped == "!") return run("", style);
			return run(escaped, style);
		}
		this.skipWhitespace();
		if (name == "frac" || name == "dfrac" || name == "tfrac") return new Omml("m:f", [new Omml("m:num", this.groupOrAtom(style)), new Omml("m:den", this.groupOrAtom(style))]);
		if (name == "sqrt")
		{
			let degree: XmlComponent[] | undefined;
			if (this.peek() == "[") { this.take(); degree = this.sequence("]", style); }
			return new Omml("m:rad", [new Omml("m:radPr", degree ? [] : [new Omml("m:degHide", [], { "m:val": "1" })]), new Omml("m:deg", degree || []), arg(this.groupOrAtom(style))]);
		}
		if (name == "text") return new Omml("m:box", [arg(this.groupOrAtom("plain", true))]);
		if (name == "mathrm" || name == "operatorname") return new Omml("m:box", [arg(this.groupOrAtom("plain"))]);
		if (name == "mathbf") return new Omml("m:box", [arg(this.groupOrAtom("bold"))]);
		if (name == "mathit") return new Omml("m:box", [arg(this.groupOrAtom("italic"))]);
		if (["mathbb", "mathcal"].includes(name)) return new Omml("m:box", [arg(this.groupOrAtom(name == "mathbb" ? "double-struck" : "script"))]);
		if (["hat", "widehat", "vec"].includes(name))
		{
			const chr = name == "vec" ? "⃗" : "̂";
			return new Omml("m:acc", [new Omml("m:accPr", [new Omml("m:chr", [], { "m:val": chr })]), arg(this.groupOrAtom(style))]);
		}
		if (["overline", "bar", "underline"].includes(name))
		{
			const pos = name == "underline" ? "bot" : "top";
			return new Omml("m:bar", [new Omml("m:barPr", [new Omml("m:pos", [], { "m:val": pos })]), arg(this.groupOrAtom(style))]);
		}
		if (name == "binom" || name == "dbinom") return delimiter([new Omml("m:f", [new Omml("m:fPr", [new Omml("m:type", [], { "m:val": "noBar" })]), new Omml("m:num", this.groupOrAtom(style)), new Omml("m:den", this.groupOrAtom(style))])], "(", ")");
		if (name == "lim")
		{
			let below = true;
			if (this.command("limits") || this.command("nolimits"))
			{
				below = this.command("limits");
				this.i += below ? 7 : 9;
				this.skipWhitespace();
			}
			let sub: XmlComponent[] = [];
			if (this.peek() == "_") { this.take(); sub = this.groupOrAtom(style); }
			if (!sub.length) return run("lim", "plain");
			return new Omml(below ? "m:limLow" : "m:sSub", [arg([run("lim", "plain")]), new Omml(below ? "m:lim" : "m:sub", sub)]);
		}
		if (["sum", "prod", "int", "iint", "iiint"].includes(name))
		{
			const chr = name == "sum" ? "∑" : name == "prod" ? "∏" : name == "iint" ? "∬" : name == "iiint" ? "∭" : "∫";
			let sub: XmlComponent[] = [], sup: XmlComponent[] = [];
			let limitLocation: string | undefined;
			while (true)
			{
				this.skipWhitespace();
				if (this.command("limits") || this.command("nolimits"))
				{
					const limits = this.command("limits");
					this.i += limits ? 7 : 9;
					limitLocation = limits ? "undOvr" : "subSup";
					continue;
				}
				if (this.peek() != "_" && this.peek() != "^") break;
				const marker = this.take(); const script = this.groupOrAtom(style);
				if (marker == "_" ? sub.length : sup.length) throw new Error("duplicate script");
				if (marker == "_") sub = script; else sup = script;
				this.skipWhitespace();
			}
			while (/\s/.test(this.peek())) this.take();
			const operand = this.done() || ["}", "]", ")", "&", "=", "<", ">"].includes(this.peek()) || this.command("right") || this.command("end") || this.source.startsWith("\\\\", this.i) ? [] : [this.decoratedAtom(style)];
			return new Omml("m:nary", [new Omml("m:naryPr", [
				new Omml("m:chr", [], { "m:val": chr }),
				...(limitLocation ? [new Omml("m:limLoc", [], { "m:val": limitLocation })] : []),
				new Omml("m:subHide", [], { "m:val": sub.length ? "0" : "1" }),
				new Omml("m:supHide", [], { "m:val": sup.length ? "0" : "1" }),
			]), new Omml("m:sub", sub), new Omml("m:sup", sup), arg(operand)]);
		}
		if (name == "left")
		{
			const begin = this.readDelimiter();
			const body = this.sequence(undefined, style, false, () => this.command("right"));
			if (!this.command("right")) throw new Error("missing \\right");
			this.i += 6;
			return delimiter(body, begin, this.readDelimiter());
		}
		if (name == "begin") return this.matrix(style);
		if (symbols[name]) return run(symbols[name]!, style);
		if (operators[name]) return run(operators[name]!, "plain");
		if (["quad", "qquad"].includes(name)) return run(name == "quad" ? "\u2003" : "\u2003\u2003", style);
		throw new Error(`unsupported command \\${name}`);
	}
	private readDelimiter(): string
	{
		this.skipWhitespace();
		const ch = this.take();
		if (ch == ".") return "";
		if (ch && "()[]|{}".includes(ch)) return ch;
		if (ch == "\\")
		{
			let name = "";
			while (/[A-Za-z]/.test(this.peek())) name += this.take();
			if (!name) name = this.take();
			const delimiters: Record<string, string> = { "{": "{", "}": "}", "|": "‖", lbrace: "{", rbrace: "}", langle: "⟨", rangle: "⟩", lvert: "|", rvert: "|", vert: "|", lVert: "‖", rVert: "‖", Vert: "‖" };
			if (delimiters[name]) return delimiters[name];
		}
		throw new Error("delimiter expected");
	}
	private matrix(style?: MathStyle): XmlComponent
	{
		if (this.peek() != "{") throw new Error("environment name expected");
		this.take(); let env = ""; while (!this.done() && this.peek() != "}") env += this.take(); this.take();
		if (!["matrix", "pmatrix", "bmatrix", "cases"].includes(env)) throw new Error(`unsupported environment ${env}`);
		const rows: XmlComponent[] = [];
		let cells: XmlComponent[] = [];
		while (true)
		{
			this.skipWhitespace();
			if (this.done()) throw new Error(`environment ${env} is not closed`);
			if (this.command("end"))
			{
				this.i += 4;
				this.skipWhitespace();
				const closing = `{${env}}`;
				if (!this.source.startsWith(closing, this.i)) throw new Error(`mismatched environment ${env}`);
				this.i += closing.length;
				if (cells.length) rows.push(new Omml("m:mr", cells));
				break;
			}
			cells.push(arg(this.sequence(undefined, style, false, () => this.peek() == "&" || this.source.startsWith("\\\\", this.i) || this.command("end"))));
			if (this.peek() == "&") { this.take(); continue; }
			if (this.source.startsWith("\\\\", this.i))
			{
				this.i += 2;
				rows.push(new Omml("m:mr", cells));
				cells = [];
			}
		}
		const matrix = new Omml("m:m", rows);
		if (env == "pmatrix") return delimiter([matrix], "(", ")");
		if (env == "bmatrix") return delimiter([matrix], "[", "]");
		if (env == "cases") return delimiter([matrix], "{", "");
		return matrix;
	}
}
