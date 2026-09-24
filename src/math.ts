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
	cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓", le: "≤", leq: "≤", ge: "≥", geq: "≥", neq: "≠", ne: "≠", approx: "≈", equiv: "≡", sim: "∼", propto: "∝", infty: "∞", partial: "∂", nabla: "∇", in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", superset: "⊃", cup: "∪", cap: "∩", to: "→", rightarrow: "→", leftarrow: "←", leftrightarrow: "↔", mapsto: "↦", forall: "∀", exists: "∃", neg: "¬", land: "∧", lor: "∨", degree: "°", ell: "ℓ", ldots: "…", dots: "…",
};
const operators: Record<string, string> = { sin: "sin", cos: "cos", tan: "tan", cot: "cot", sec: "sec", csc: "csc", log: "log", ln: "ln", exp: "exp", max: "max", min: "min", gcd: "gcd", det: "det" };

function run(text: string): XmlComponent { return new Omml("m:r", [new Omml("m:t", [text])]); }
function arg(children: XmlComponent[]): XmlComponent { return new Omml("m:e", children); }

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
	sequence(stop?: string): XmlComponent[]
	{
		const result: XmlComponent[] = [];
		while (!this.done() && this.peek() != stop)
		{
			if (/\s/.test(this.peek())) { this.take(); continue; }
			let value = this.atom();
			let sub: XmlComponent[] | undefined;
			let sup: XmlComponent[] | undefined;
			while (this.peek() == "_" || this.peek() == "^")
			{
				const marker = this.take(); const script = this.groupOrAtom();
				if (marker == "_") sub = script; else sup = script;
			}
			if (sub && sup) value = new Omml("m:sSubSup", [new Omml("m:e", [value]), new Omml("m:sub", sub), new Omml("m:sup", sup)]);
			else if (sub) value = new Omml("m:sSub", [new Omml("m:e", [value]), new Omml("m:sub", sub)]);
			else if (sup) value = new Omml("m:sSup", [new Omml("m:e", [value]), new Omml("m:sup", sup)]);
			result.push(value);
		}
		if (stop) { if (this.take() != stop) throw new Error(`missing "${stop}"`); }
		return result;
	}
	private groupOrAtom(): XmlComponent[]
	{
		if (this.peek() == "{") { this.take(); return this.sequence("}"); }
		return [this.atom()];
	}
	private atom(): XmlComponent
	{
		const ch = this.take();
		if (ch == "{") return new Omml("m:box", [arg(this.sequence("}"))]);
		if (ch != "\\") return run(ch);
		let name = "";
		while (/[A-Za-z]/.test(this.peek())) name += this.take();
		if (!name) return run(this.take());
		if (name == "frac" || name == "dfrac" || name == "tfrac") return new Omml("m:f", [new Omml("m:num", this.groupOrAtom()), new Omml("m:den", this.groupOrAtom())]);
		if (name == "sqrt")
		{
			let degree: XmlComponent[] | undefined;
			if (this.peek() == "[") { this.take(); degree = this.sequence("]"); }
			return new Omml("m:rad", [new Omml("m:radPr", degree ? [] : [new Omml("m:degHide", [], { "m:val": "1" })]), new Omml("m:deg", degree || []), arg(this.groupOrAtom())]);
		}
		if (["text", "mathrm", "mathbf", "mathit", "mathbb", "mathcal", "operatorname"].includes(name)) return new Omml("m:box", [arg(this.groupOrAtom())]);
		if (["overline", "bar", "vec", "hat", "widehat", "underline"].includes(name))
		{
			const pos = name == "underline" ? "bot" : "top";
			return new Omml("m:bar", [new Omml("m:barPr", [new Omml("m:pos", [], { "m:val": pos })]), arg(this.groupOrAtom())]);
		}
		if (name == "binom" || name == "dbinom") return new Omml("m:f", [new Omml("m:fPr", [new Omml("m:type", [], { "m:val": "noBar" })]), new Omml("m:num", this.groupOrAtom()), new Omml("m:den", this.groupOrAtom())]);
		if (["sum", "prod", "int", "iint", "iiint", "lim"].includes(name))
		{
			const chr = name == "sum" ? "∑" : name == "prod" ? "∏" : name.includes("int") ? "∫" : "lim";
			let sub: XmlComponent[] = [], sup: XmlComponent[] = [];
			while (this.peek() == "_" || this.peek() == "^")
			{
				const marker = this.take(); const script = this.groupOrAtom();
				if (marker == "_") sub = script; else sup = script;
			}
			return new Omml("m:nary", [new Omml("m:naryPr", [new Omml("m:chr", [], { "m:val": chr })]), new Omml("m:sub", sub), new Omml("m:sup", sup), arg([])]);
		}
		if (name == "left" || name == "right") { while (/\s/.test(this.peek())) this.take(); return run(this.take()); }
		if (name == "begin") return this.matrix();
		if (symbols[name]) return run(symbols[name]!);
		if (operators[name]) return run(operators[name]!);
		if (["quad", "qquad", ",", ";", "!"].includes(name)) return run(" ");
		if (["displaystyle", "textstyle", "limits", "nolimits"].includes(name)) return run("");
		throw new Error(`unsupported command \\${name}`);
	}
	private matrix(): XmlComponent
	{
		if (this.peek() != "{") throw new Error("environment name expected");
		this.take(); let env = ""; while (!this.done() && this.peek() != "}") env += this.take(); this.take();
		if (!["matrix", "pmatrix", "bmatrix", "cases"].includes(env)) throw new Error(`unsupported environment ${env}`);
		const end = `\\end{${env}}`; const endAt = this.source.indexOf(end, this.i);
		if (endAt < 0) throw new Error(`environment ${env} is not closed`);
		const content = this.source.slice(this.i, endAt); this.i = endAt + end.length;
		const rows = content.split(/\\\\/).map(row => new Omml("m:mr", row.split("&").map(cell => new Omml("m:e", new LatexParser(cell).sequence()))));
		return new Omml("m:m", rows);
	}
}
