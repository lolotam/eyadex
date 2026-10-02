import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useMk } from "./mk-context";

export function FaqAct() {
  const { d } = useMk();
  return (
    <section className="mk-section mk-faq" aria-labelledby="mk-faq-h">
      <div className="mk-wrap mk-faq-wrap">
        <h2 id="mk-faq-h" className="mk-h2">{d.faq.h2}</h2>
        <Accordion type="single" collapsible>
          {d.faq.items.map((item, i) => (
            <AccordionItem key={item.q} value={`q${i}`} className="mk-faq-item">
              <AccordionTrigger className="mk-faq-q">{item.q}</AccordionTrigger>
              {/* forceMount keeps every answer in the server HTML; CSS hides closed ones. */}
              <AccordionContent forceMount className="mk-faq-a">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
