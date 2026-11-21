export const TOC_HEADINGS = ["ОГЛАВЛЕНИЕ", "СОДЕРЖАНИЕ"] as const;
export const SOURCE_HEADINGS = ["СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ", "СПИСОК ЛИТЕРАТУРЫ"] as const;
export const SPECIAL_HEADINGS: readonly string[] = [
	"РЕФЕРАТ", ...TOC_HEADINGS, "ТЕРМИНЫ И ОПРЕДЕЛЕНИЯ", "ПЕРЕЧЕНЬ СОКРАЩЕНИЙ И ОБОЗНАЧЕНИЙ",
	"ВВЕДЕНИЕ", "ЗАКЛЮЧЕНИЕ", ...SOURCE_HEADINGS, "ПРИЛОЖЕНИЯ",
];
export const isTocHeading = (text: string) => TOC_HEADINGS.some(value => value == text.trim().toUpperCase());
export const isSourceHeading = (text: string) => SOURCE_HEADINGS.some(value => value == text.trim().toUpperCase());

export function isSpecialHeading(text: string): boolean
{
	const name = text.trim().replace(/\s/g, " ").toUpperCase();
	return SPECIAL_HEADINGS.includes(name) || name.startsWith("ТИТУЛЬНИК");
}

export function parseHeadingText(text: string): { text: string, notSpecial?: true }
{
	return text.startsWith("\\") && isSpecialHeading(text.slice(1))
		? { text: text.slice(1), notSpecial: true }
		: { text };
}
