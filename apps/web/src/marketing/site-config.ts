export const SITE = {
  url: "https://eyadex.com",
  whatsapp: "", // TODO(spec): owner to supply, international format without +, e.g. 9655xxxxxxx
  email: "hello@eyadex.com", // TODO(spec): confirm
};

export function demoHref(text: string): { href: string; external: boolean } {
  if (SITE.whatsapp)
    return {
      href: `https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent(text)}`,
      external: true,
    };
  return { href: `mailto:${SITE.email}?subject=${encodeURIComponent(text)}`, external: false };
}
