import { useMk } from "./mk-context";
import { demoHref } from "./site-config";

export function DemoLink({ size = "md" }: { size?: "md" | "lg" }) {
  const { d } = useMk();
  const { href, external } = demoHref(d.demo.text);
  return (
    <a
      className={`mk-btn mk-btn--primary${size === "lg" ? " mk-btn--lg" : ""}`}
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {d.demo.label}
    </a>
  );
}
