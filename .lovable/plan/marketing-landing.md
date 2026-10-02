# Eyadex marketing landing page: build spec

Before writing markup, read `.agents/skills/scroll-craft/SKILL.md`, `references/hero-depth.md`, `references/taste.md` and `references/devices.md`. Their taste rules are binding. This page is a React/TanStack Start port of that method: do NOT copy the vanilla engine, write the motion as small typed hooks in `src/marketing/motion/`.

Hard constraints still hold: no Lovable Cloud, no Supabase, no forms that store data, no analytics or trackers, no new component library, no global token changes, no edits to app screens except the two listed in §1.

---

## 0. What this page must achieve

- The most memorable B2B SaaS landing page in the Gulf health market, and an SEO-first one.
- Audience: owners and medical directors of clinics of every specialty in Kuwait, usually with 1 to 5 branches. Arabic first.
- The visitor must leave believing ONE sentence: "With Eyadex I decide who sees what in my clinic, and even Eyadex cannot see my patients."
- One action, one label everywhere: **احجز عرضًا** / **Book a demo**.
- Tell-someone sentence: "It's the site where even the software company shows you it can't read your patients' files."

Honesty rules (ship-blockers): no invented customers, testimonials, client logos, ratings, statistics, counters, prices, launch dates or certifications. Sample data is labelled "بيانات تجريبية / Sample data" on its face. Roadmap items carry no dates.

---

## 1. Routing and app changes

1. Move the persona sign-in page from `/` to **`/login`**:
   - new `src/routes/login.tsx` (thin: head + re-export of the existing `LandingPage` component, which you may rename to `SignInPage` in `src/shared/shell/sign-in-page.tsx`).
   - Update every navigation/redirect that means "go to sign-in" (sign-out, persona reset, guards, the forbidden page, suspended/expired clinic flows) to `/login`. Grep for `to="/"`, `navigate({ to: "/" })`, `href="/"` and decide each one.
   - `/login`, `/platform/*`, `/clinic/*`, `/forbidden` get `<meta name="robots" content="noindex,nofollow">`.
2. New public routes:
   - `src/routes/index.tsx` → Arabic landing (`lang="ar"`, `dir="rtl"`).
   - `src/routes/en.tsx` → English landing (`lang="en"`, `dir="ltr"`).
   - Both render `<MarketingPage lang="ar|en" />` from `src/marketing/marketing-page.tsx`.
3. SSR language: the server HTML of `/en` must contain `<html lang="en" dir="ltr">` and `/` must contain `<html lang="ar" dir="rtl">`. Derive it in `RootShell` from the current pathname (marketing routes only). The app `I18nProvider` effect must NOT overwrite `<html lang/dir>` while a marketing route is active (pass a flag or check the route). The marketing page takes its strings from `src/marketing/i18n/{ar,en}.ts` (typed, same keys), never from localStorage. The language link is a real `<a href>` to the other route.
4. Replace the stethoscope icon on the sign-in card and in the app shell header with the new Eyadex mark (`/brand/eyadex-mark.svg`, or `/brand/eyadex-mark-white.svg` on teal). That is the only app UI change.
5. Keep `src/test/app-routing.test.tsx` passing (index route still renders).

---

## 2. SEO (non-negotiable)

Put this in `src/marketing/seo/marketing-head.ts` and use it from both routes' `head()`.

**Arabic `/`**

- title: `Eyadex | نظام إدارة العيادات متعددة التخصصات والفروع في الكويت`
- description: `Eyadex نظام لإدارة العيادات بكل تخصصاتها وفروعها في الكويت: نفسية، جلدية، نساء وولادة وغيرها. فروع وأدوار وصلاحيات دقيقة وملفات مراجعين محمية وسجل لكل من فتح ملفًا. احجز عرضًا.`

**English `/en`**

- title: `Eyadex | Clinic management software for every specialty in Kuwait`
- description: `Eyadex is clinic management for every specialty and branch in Kuwait: dermatology, psychiatry, OB/GYN and more. Branches, precise roles and permissions, protected patient files and a log of every file opened. Book a demo.`

Both pages:

- `<link rel="canonical">` to `https://eyadex.com/` and `https://eyadex.com/en`.
- `hreflang`: `ar-KW` → `/`, `en` → `/en`, `x-default` → `/`.
- Open Graph: `og:type=website`, `og:site_name=Eyadex`, `og:locale` (`ar_KW` / `en_US`) + `og:locale:alternate`, `og:url`, `og:title`, `og:description`, `og:image=https://eyadex.com/og/og-ar.jpg` (or `og-en.jpg`), `og:image:width=1200`, `og:image:height=630`, `og:image:alt`. Twitter: `summary_large_image` + same image.
- `theme-color` `#0E5C59`, `<link rel="manifest" href="/site.webmanifest">`, icons: `/favicon.ico` (sizes any), `/brand/eyadex-icon.svg` (type image/svg+xml), `/apple-touch-icon.png`. Update the root head icon links app-wide to these.
- Preload the hero poster for the viewport (`<link rel="preload" as="image" fetchpriority="high" href="/marketing/hero-desktop.webp" media="(min-width: 768px)">` and the mobile one with the inverse media).
- JSON-LD (one `<script type="application/ld+json">` per page, built from the same strings): `Organization` (name, url, logo `https://eyadex.com/icon-512.png`), `WebSite` (name, url, inLanguage), `SoftwareApplication` (name Eyadex, applicationCategory `BusinessApplication`, applicationSubCategory `Clinic management`, operatingSystem `Web`, areaServed `KW`, inLanguage `["ar","en"]`, description, url). **No `offers`, no `aggregateRating`.** `FAQPage` built from the FAQ section (act 7), same text as rendered.
- One `<h1>` per page (hero). Sections use `<section aria-labelledby>` with real `<h2>`.
- Static files in `/public`: `robots.txt` (allow all; disallow `/login`, `/platform`, `/clinic`, `/forbidden`; `Sitemap: https://eyadex.com/sitemap.xml`), `sitemap.xml` (both URLs with `xhtml:link` hreflang alternates, lastmod 2026-10-03), `llms.txt` (plain-language summary of what Eyadex is, who it is for, what the MVP does, what is on the roadmap, and the two URLs), `site.webmanifest` (name, short_name, icons 192/512, theme_color `#0E5C59`, background_color `#F6F4EE`, display `standalone`, lang `ar`, dir `rtl`).
- Core Web Vitals targets on a mid phone: LCP < 2.5s (LCP = hero poster), CLS < 0.05, INP < 200ms. Every `<img>` has width+height (or aspect-ratio). Below-the-fold images `loading="lazy" decoding="async"`. Videos never block LCP: they load after `load` + idle.
- All copy is SSR-rendered text, never baked into images, never only in JS.

---

## 3. Assets (already saved)

| Path                                                                         | Use                                                     |
| ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| `public/marketing/hero-desktop.mp4`                                          | hero scrub video, 16:9, 6.6s, dense keyframes, no audio |
| `public/marketing/hero-desktop.webp`                                         | its own first frame (poster, LCP) 2560×1440             |
| `public/marketing/hero-mobile.mp4`                                           | hero scrub video, 9:16                                  |
| `public/marketing/hero-mobile.webp`                                          | its own first frame 720×1280                            |
| `public/marketing/olive.webp`                                                | foreground olive branch, real alpha                     |
| `public/marketing/key-{admin,doctor,receptionist,tech,team}.webp`            | the five keys, real alpha                               |
| `public/marketing/corridor.webp`                                             | corridor of frosted doors 1920×1080                     |
| `public/marketing/close.webp`                                                | golden-hour room, door open (close) 1920×1080           |
| `public/brand/eyadex-mark.svg`, `eyadex-mark-white.svg`, `eyadex-icon.svg`   | logo (arch doorway with an "e")                         |
| `public/favicon.ico`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | icons                                                   |
| `public/og/og-ar.jpg`, `public/og/og-en.jpg`                                 | social cards 1200×630                                   |

Do not substitute stock or generated images.

---

## 4. Design layer `.mk` (scoped, extends "Clinical Operations")

All marketing styles live in `src/marketing/marketing.css`, scoped under `.mk`, imported by the marketing page only. Tokens:

```css
.mk {
  --mk-canvas: #f6f4ee;
  --mk-surface: #ffffff;
  --mk-ink: #14211f;
  --mk-ink-soft: #4a5d5a;
  --mk-accent: var(--primary); /* the app's deep teal, the ONLY accent */
  --mk-accent-ink: #f7f5f0;
  --mk-line: rgba(20, 33, 31, 0.12);
  --mk-frost: rgba(246, 244, 238, 0.58);
  --mk-frost-edge: rgba(255, 255, 255, 0.65);
  --mk-oak: #b08756; /* material colour for the door stile only, never UI */
  --mk-ease: cubic-bezier(0.23, 1, 0.32, 1);
  --mk-radius: 8px;
  --mk-gutter: clamp(16px, 4vw, 56px);
  --mk-measure: 62ch;
  --mk-shadow-1: 0 1px 2px rgba(14, 50, 48, 0.06), 0 4px 12px rgba(14, 50, 48, 0.06);
  --mk-shadow-2: 0 2px 6px rgba(14, 50, 48, 0.08), 0 18px 40px rgba(14, 50, 48, 0.1);
  background: var(--mk-canvas);
  color: var(--mk-ink);
}
```

Typography (two families, already loaded): IBM Plex Sans Arabic for `ar`, IBM Plex Sans for `en`.

- Display: weight 600, `clamp(2.5rem, 5vw, 5.25rem)`; line-height 1.15 (ar) / 1.02 (en).
- h2: weight 600, `clamp(1.9rem, 3.4vw, 3.4rem)`.
- Body: 1.0625rem, line-height 1.85 (ar) / 1.65 (en), measure 62ch.
- **Never set letter-spacing on Arabic text** (it breaks letter joining). English display tracking `-0.02em`.
- `text-wrap: balance` on headings, `pretty` on paragraphs. Tabular numerals in data.
- Below 700px step the hero display down one rung.

Surfaces and details: flat white surfaces with 1px `--mk-line`, at most two shadow steps, 1px top edge-light on raised panels, a 4% grain overlay (`.mk-grain`, CSS noise) on the canvas. Frosted glass is a MATERIAL with meaning here (privacy), used only for: the hero door, frosted rows in the Keyring, the corridor caption plate, the nav after the hero. `backdrop-filter: blur(18px) saturate(1.15)` with an opaque fallback when unsupported.

Browser surfaces: `::selection` teal tint, caret teal, focus-visible ring 2px teal with 3px offset on everything interactive, themed scrollbar, link underline offset 0.2em.

Logical CSS only (`ps/pe/ms/me`, `inset-inline-*`, `start/end`). Mirror every directional motion via a `--dir` multiplier (`1` in RTL, `-1` in LTR) instead of duplicating code.

Refuse list (from taste.md): no em dashes in visible copy, no "scroll" cue or mouse icon, no section numbers, eyebrow at most once per three sections, no gradient text, no glow, no 3 equal feature cards, no icon+heading+text card grids, no pills on photos, no custom cursor, `transform`/`opacity`/`clip-path` only for motion, never `transition: all`, UI transitions under 300ms with `--mk-ease`, press feedback `scale(0.97)`, hover only under `(hover: hover) and (pointer: fine)`.

---

## 5. The page, act by act

Write all copy below exactly (both languages) into `src/marketing/i18n/ar.ts` / `en.ts`. Where a heading and its body are given separately, they are two separate elements; never join them with a dash.
Motion lives in hooks: `useScrollProgress(ref)` (rAF, passive scroll listener, writes a CSS var `--p` 0..1 on the section, no React re-render per frame), `useReducedMotion()`, `useMedia(query)`. Pause anything offscreen with IntersectionObserver.

### Nav (fixed, minimal: no anchor index)

Start side: Eyadex lockup (`eyadex-mark.svg` + "Eyadex" wordmark in IBM Plex Sans 600, always LTR inside the lockup). End side: language link ("English" on `/`, "عربي" on `/en`), a quiet text link to `/login` ("تسجيل الدخول" / "Sign in"), and the primary button **احجز عرضًا / Book a demo**. Transparent over the hero, gains a frosted canvas background + hairline once the hero exits. Mobile: lockup + Book a demo button + a small menu button opening a sheet with the two links.

### Act 1. The quiet room (hero, layered, pinned). Feeling: calm, recognition

Section height `230vh` desktop / `180vh` mobile; a `100svh` sticky stage inside. Layer contract (back to front):

| Plane       | Asset                                                                                                                                | Motion over `--p` 0→1                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Far         | hero video (poster first)                                                                                                            | `currentTime = p × duration × 0.96`, eased with a lerp (0.12) so the wheel feels like a dolly                                      |
| Atmosphere  | CSS radial sunbeam from the window side, warm, 18% max                                                                               | opacity 0.6→1→0.7, drifts 3vw toward the window                                                                                    |
| Near        | `olive.webp`, hanging from the top on the room side, slight `blur(1.2px)`                                                            | translateY 0→-22vh, rotate 0→-4deg, the fastest plane                                                                              |
| Door        | frosted glass panel covering the inline-start 52% (desktop) with a 10px oak stile on its inner edge and a slim vertical brass handle | slides toward the inline-start edge (`translateX` by `--dir`) between p 0.18 and 0.72 until fully off-screen: the door slides open |
| Type        | H1, lead, buttons, set ON the frosted door (the glass is the scrim, no overlay anywhere)                                             | moves with the door, fades out p 0.30→0.52                                                                                         |
| Second beat | one line centred low over the now-clear room                                                                                         | fades in p 0.58→0.70, holds, fades p 0.90→1                                                                                        |

- In the plate the room sits on the LEFT and a calm wall on the RIGHT, so the RTL door (inline-start = right) covers the wall, not the room.
- Pointer (fine pointers only): up to 10px translate on the olive, 4px on the video, opposite directions. Never pointer lock.
- `/en`: mirror ONLY the media planes with `scaleX(-1)` (the plate has no text), door on the left.
- Mobile: portrait video + poster; the door becomes a frosted panel over the BOTTOM 56% of the frame holding the copy, sliding down off-screen; olive smaller in the top corner.
- Reduced motion: no pin (section `100svh`), poster only, door static at rest, all copy visible.
- Video: `muted playsInline preload="none"`, `src` chosen by `matchMedia('(max-width: 767px)')` (not `<source media>`), assigned after `load` + `requestIdleCallback`; poster stays until `seeked` fires once. If the video cannot seek within 3s, keep the poster (no broken state).

Copy:

- H1 ar: `كل ملف في عيادتك، خلف الباب الصحيح.`
- H1 en: `Every file in your clinic, behind the right door.`
- Lead ar: `Eyadex نظام لإدارة العيادات بكل تخصصاتها وفروعها: نفسية، جلدية، نساء وولادة وغيرها. أساس واحد ثابت لكل عيادة، وأقسام إضافية حسب تخصصك، وأنت تقرر من يرى ماذا.`
- Lead en: `Eyadex is clinic management for every specialty and every branch, whether you serve patients or clients: dermatology, psychiatry, OB/GYN and more. One fixed core for every clinic, extra sections for your specialty, and you decide who sees what.`
- Primary: `احجز عرضًا` / `Book a demo`. Secondary text link to `#keyring`: `جرّب المفاتيح بنفسك` / `Try the keys yourself`.
- Second beat ar: `غرفة هادئة. ملفات محمية. وفريق يرى ما يحتاجه فقط.`
- Second beat en: `A quiet room. Protected files. A team that sees only what it needs.`

### Act 2. The truth (pinned type). Feeling: unease

Canvas ground, `200vh`, sticky stage. Three lines assemble one at a time (each enters `translateY(12px)`+opacity, previous lines dim to 35%), anchored to the inline-start column, large (h2 scale). Then an **authored silence**: ~40vh of empty canvas before Act 3.

- ar: `ملف المراجع ليس ملفًا عاديًا، أيًّا كان تخصصك.` / `موظف الاستقبال في فرع لا يحتاج إلى رؤية مراجعي فرع آخر.` / `ومن يبيعك النظام لا يحتاج أن يرى مراجعيك أبدًا.`
- en: `A patient file is not an ordinary file, whatever your specialty.` / `Front desk in one branch has no reason to see another branch's patients.` / `And the company selling you the software has no reason to see your patients and clients at all.`
- h2 (visually hidden, for the outline): `لماذا الخصوصية أولًا` / `Why privacy comes first`.

### Act 3. The Keyring (SIGNATURE MOVE + PEAK). Feeling: control, then surprise

`id="keyring"`. Desktop: `360vh` with a sticky stage (the largest span on the page). Mobile: not pinned, a normal section with a horizontal key rail (scroll-snap, tap to choose).

Heading ar: `اختر مفتاحًا. شاهد ما يُفتح.` en: `Pick a key. See what opens.`
Sub ar: `عيادة افتراضية ببيانات تجريبية. هذه هي الأدوار الافتراضية التي تبدأ بها كل عيادة جديدة، ويمكنك تعديلها أو بناء أدوارك.`
Sub en: `A fictional clinic with sample data. These are the default roles every new clinic starts with; you can edit them or build your own.`
A small label on the panel: `بيانات تجريبية` / `Sample data`.

Stage layout: inline-start column = a thin brass rail with the five key images hanging from it (`key-admin`, `key-doctor`, `key-receptionist`, `key-tech`, `key-team`), each a real `<button role="radio">` inside a `role="radiogroup"` with its role name under it (`مدير العيادة / Clinic admin`, `طبيب / Doctor`, `موظف استقبال / Receptionist`, `فني / Technician`, `فريق Eyadex / Eyadex team`). Selected key lifts 10px and swings 4deg, others dim to 55%. Inline-end column = a **real, computing** mini Eyadex window built with the app's own visual language (white surface, hairlines, teal active state, IBM Plex): a narrow sidebar (Overview, Branches, Users, Roles, المراجعون / Patients, Audit log, Settings), a patients table, and an open patient file panel.

Logic (pure functions in `src/marketing/keyring/keyring-model.ts`, unit-testable):

- Import `PERMISSION_CATALOG` from `@contracts/permissions` and `ROLE_TEMPLATES` from `src/shared/api/mock/seed-roles.ts` (pure data only, never the mock store or ApiClient), so the demo always matches the real defaults.
- Sample clinic: `مجمع السكينة الطبي (عيّنة) / Al Sakina Medical Centre (sample)`, branches `السالمية / Salmiya` and `حولي / Hawalli`. Sample personas: Clinic admin (all branches), Doctor (Salmiya), Receptionist (Salmiya), Technician (Hawalli).
- Six sample patients, three per branch, fictional names, file numbers 1041..1046, phones masked like `+965 5••• ••37`, no civil ID, no clinical data.
- For the chosen key compute: visible sidebar items (from `view:*` permissions), visible rows (clinic scope = all; branch scope = rows in the persona's branches; others render as a frosted row with the text `خارج فروعك / Outside your branches`), and which buttons exist (`New patient` needs create, `Edit` needs update, `Archive` needs deactivate). Buttons that are not allowed are absent, not disabled.
- Under the window, one caption line generated from the computed result, e.g. ar `يرى مراجعي فرع السالمية فقط، ويستطيع الإضافة والتعديل.`, en `Sees Salmiya patients only, and can add and edit.` (build from parts, both languages, so it is always true to ROLE_TEMPLATES).
- Each time a key that can view is selected, the sample file 1042 opens and a line is appended to a small ledger under the window: `{persona} فتح ملف 1042 · الآن` / `{persona} opened file 1042 · just now` (max 4 lines, newest first). For a key whose branch scope excludes 1042, open the first patient it can see instead. This shows the audit log of patient access.
- **The Eyadex team key (the peak):** the platform has no grant on patient data. The whole patient area frosts over (rows, file, buttons), the sidebar shrinks to Overview only, and a stamp appears in the middle with a small lock icon: ar `مرفوض من قاعدة البيانات نفسها.` + `فريق Eyadex يدير اشتراك عيادتك، ولا يملك أي صلاحية للوصول إلى بيانات المراجعين.` en `Refused by the database itself.` + `The Eyadex team manages your clinic's subscription and has no grant on the patients table.` The ledger adds no line (nothing was opened).
- Desktop scroll drives the key in order admin → doctor → receptionist → technician → team, with the team key owning the last 40% of the span (the peak gets the most room). Clicking a key selects it immediately; scrolling only changes the key when the progress crosses into a new segment. Keyboard: arrow keys move within the radiogroup.
- Frost transitions: 280ms opacity + backdrop-filter, rows staggered 40ms.

### New Act. One core, your specialty on top. Feeling: recognition

Not pinned. Two-column layout: inline-start has the heading and paragraph; inline-end has one specialty segmented control above a real two-layer diagram. The solid core band stays perfectly still while only the lighter specialty band crossfades over 240ms.

- h2 ar `أساس واحد لكل العيادات. وتخصصك فوقه.` en `One core for every clinic. Your specialty on top.`
- p ar `كل عيادة تحصل على الأساس نفسه من اليوم الأول. ومع كل تخصص تأتي أقسام إضافية تناسب طريقة عمله، دون أن يتغير شيء في الأساس.` en `Every clinic gets the same core from day one. Each specialty adds sections that fit how it works, without changing anything in the core.`
- Selector: نفسية / Psychiatry · جلدية / Dermatology · نساء وولادة / OB/GYN · عيادة عامة / General practice. These names must be present in SSR text.
- Core band, always unchanged: الفروع، الفريق، الأدوار والصلاحيات، ملفات المراجعين، سجل التدقيق، الاشتراك / Branches, Team, Roles and permissions, Patient files, Audit log, Subscription.
- Specialty band, labelled `حسب التخصص / By specialty`; every item carries `على خارطة الطريق / On the roadmap`: نفسية = الجلسات وملاحظات الطبيب، خطط العلاج / Sessions and doctor notes, Treatment plans; جلدية = صور قبل وبعد، جلسات الليزر والإجراءات / Before and after photos, Laser and procedure sessions; نساء وولادة = متابعة الحمل، مواعيد السونار / Pregnancy follow-up, Ultrasound visits; عيادة عامة = الزيارات والوصفات / Visits and prescriptions.

### Act 4. How it holds. Feeling: confidence

Two parts, different devices.

**4a. The plan draws itself.** A pinned (`220vh`) SVG line drawing of a clinic floor plan, sized about `55vw` (max 760px) on desktop and `92vw` on mobile. A substantial outer outline is visible on arrival, the first room completes by p 0.10, then the plan splits into branch wings and draws rooms and doors through p 0.75. `stroke-dashoffset` from `--p`, 1.5px teal strokes on canvas, no fill. Three callouts arrive at their parts of the drawing (HTML text, not SVG text), asymmetric, not cards. Each callout = a short heading + a body paragraph:

- Heading ar `عيادة، ثم فروع.` Body ar `مستويان فقط وواضحان: العيادة وفروعها. لكل شخص في فريقك الفروع التي تسمح له بها، أو كل الفروع.` Heading en `A clinic, then branches.` Body en `Two clear levels: the clinic and its branches. Each person on your team works in the branches you allow, or in all of them.`
- Heading ar `أدوار تبنيها أنت.` Body ar `اختر من كتالوج واضح: عرض، إضافة، تعديل، تعطيل، لكل قسم، على مستوى العيادة كلها أو فروع الشخص فقط. التعديل يسري فورًا.` Heading en `Roles you build.` Body en `Pick from a clear catalogue: view, add, edit, deactivate, per module, for the whole clinic or only the person's own branches. Changes apply immediately.`
- Heading ar `لا شيء يُحذف نهائيًا.` Body ar `المستخدمون والفروع والأدوار تُعطَّل، وملفات المراجعين تُؤرشف. السجل يبقى كاملًا.` Heading en `Nothing is hard-deleted.` Body en `Users, branches and roles are deactivated, patient files are archived. The record stays whole.`

**4b. The corridor (parallax + ledger).** Full-bleed `corridor.webp` with slow parallax (image translates 8vh across the section) and a frosted caption plate on the inline-start side (mask the image away from the plate, no scrim):

- h2 ar `كل باب يُفتح لمن تختاره فقط.` en `Every door opens only for the people you choose.`
- p ar `سجل تدقيق للإضافة فقط: من غيّر دورًا، من أوقف مستخدمًا، ومن فتح ملف مراجع ومتى. لا يُعدَّل ولا يُحذف.` en `An append-only audit log: who changed a role, who deactivated a user, who opened a patient file and when. It cannot be edited or deleted.`
- Below the plate, a ledger that writes itself line by line when in view (60ms stagger, monospace allowed here because it is data, tabular numerals), labelled Sample data: `09:12  مدير العيادة  عدّل دور «طبيب»` / `09:40  د. سارة  فتحت ملف 1042` / `10:05  مدير العيادة  أضاف فرع حولي` / `10:31  موظفة الاستقبال  سجّلت مراجعًا جديدًا 1046` (English: `09:12  Clinic admin  edited role "Doctor"` / `09:40  Dr. Sara  opened file 1042` / `10:05  Clinic admin  added branch Hawalli` / `10:31  Receptionist  registered new patient 1046`).
- One more short line under it: ar `وكل عيادة معزولة عن غيرها داخل قاعدة البيانات نفسها، لا في الواجهة فقط.` en `And every clinic is isolated from every other inside the database itself, not just in the interface.`
- One plain sentence on subscriptions (no card): ar `ترى دائمًا عدد مستخدميك وفروعك مقابل حدود اشتراكك، وتصلك تنبيهات قبل انتهائه.` en `You always see your users and branches against your subscription limits, with reminders before it ends.`

### Act 5. Your language, both directions. Feeling: delight

Canvas ground, not pinned. h2 ar `عربي أولًا. وإنجليزي بالإتقان نفسه.` en `Arabic first. English just as carefully.` p ar `الواجهة كاملة تنقلب بين العربية من اليمين والإنجليزية من اليسار، ولكل مستخدم لغته.` en `The whole interface flips between right-to-left Arabic and left-to-right English, and every user keeps their own language.` Interaction: a segmented control `عربي | English` above a small sample branches table (two rows, real markup, Sample data). Toggling flips ONLY that sample's `dir` and strings, with a 240ms crossfade + 12px slide in the reading direction. It never changes the page language.

### Act 6. What's next (honest roadmap). Feeling: trust

Short, quiet, two-column on desktop (heading + intro in one column, list in the other). h2 ar `ما بعد الأساس` en `After the foundation`. p ar `بدأنا بما لا يُبنى شيء بأمان من دونه: العزل والصلاحيات والسجل. وهذا ما نعمل عليه بعده.` en `We started with what nothing can be built safely without: isolation, permissions and the audit log. This is what we are working on next.` List (each with a small `على خارطة الطريق / On the roadmap` tag, no dates): المواعيد والجدولة / Appointments and scheduling · أقسام خاصة بكل تخصص / Sections for each specialty · الملف الطبي / Medical record · التنبيهات بالبريد ثم واتساب / Notifications, email then WhatsApp · الإدارة المالية / Finance · صفحة لكل عيادة على نطاقها / A page for each clinic on its own address · مساعد ذكي / An AI assistant.

### Act 7. Questions (FAQ, also JSON-LD). Feeling: reassurance

shadcn `Accordion`, single column, max 760px, h2 ar `أسئلة شائعة` en `Questions`. Answers must be present in the SSR HTML (collapsed content still in the DOM).

1. `لمن صُمّم Eyadex؟` / `للعيادات بكل تخصصاتها، بفرع واحد أو أكثر: نفسية وجلدية ونساء وولادة وغيرها. الأساس واحد للجميع، والأقسام الخاصة بكل تخصص على خارطة الطريق.` | `Who is Eyadex for?` / `Clinics of every specialty, with one branch or many: dermatology, psychiatry, OB/GYN and more. The core is the same for everyone; sections for each specialty are on the roadmap.`
2. `هل يستطيع فريق Eyadex رؤية بيانات مراجعي عيادتي؟` / `لا. حساب المنصة لا يملك أي صلاحية للوصول إلى بيانات المراجعين في قاعدة البيانات، فلا تظهر له في أي شاشة أو سجل.` | `Can the Eyadex team see my patients' and clients' data?` / `No. The platform account has no access to patient or client data in the database, so that data never appears to it on any screen or log.`
3. `هل بيانات عيادتي معزولة عن العيادات الأخرى؟` / `نعم. كل سجل يحمل هوية عيادته، وقاعدة البيانات نفسها ترفض أي طلب من عيادة على بيانات عيادة أخرى.` | `Is my clinic's data isolated from other clinics?` / `Yes. Every record carries its clinic's identity, and the database itself refuses any request from one clinic for another clinic's data.`
4. `هل يدعم أكثر من فرع؟` / `نعم. تضيف فروعك، وتحدد لكل مستخدم الفروع التي يعمل بها أو كل الفروع.` | `Does it support several branches?` / `Yes. You add your branches and choose, for each user, the branches they work in or all of them.`
5. `هل أستطيع إنشاء أدوار خاصة بعيادتي؟` / `نعم. تبدأ بأدوار جاهزة (مدير العيادة، طبيب، موظف استقبال، فني) ثم تعدلها أو تنشئ أدوارك من كتالوج الصلاحيات.` | `Can I create my own roles?` / `Yes. You start with ready roles (clinic admin, doctor, receptionist, technician), then edit them or build your own from the permission catalogue.`
6. `هل الواجهة بالعربية؟` / `العربية هي اللغة الافتراضية مع دعم كامل للإنجليزية، وكل مستخدم يختار لغته.` | `Is the interface in Arabic?` / `Arabic is the default, with full English support, and every user picks their own language.`
7. `كيف أبدأ؟` / `احجز عرضًا. بعد الحديث معك نجهز عيادتك وفروعها، ونرسل دعوة لمدير العيادة ليضع كلمة مروره بنفسه.` | `How do I get started?` / `Book a demo. After we talk, we set up your clinic and its branches and send an invitation to your clinic admin, who sets their own password.`
8. `ما الذي يتضمنه الآن؟` / `الأساس: العيادات والفروع والمستخدمون والأدوار والصلاحيات وملفات المراجعين الأساسية وسجل التدقيق. المواعيد والجلسات والمالية على خارطة الطريق.` | `What does it include today?` / `The foundation: clinics, branches, users, roles and permissions, basic patient files and the audit log. Appointments, sessions and finance are on the roadmap.`
9. `هل يناسب عيادتي الجلدية أو عيادة النساء والولادة؟` / `نعم. الأساس من فروع وأدوار وصلاحيات وملفات مراجعين وسجل يعمل لكل التخصصات اليوم، والأقسام الخاصة بتخصصك تُضاف فوقه.` | `Will it fit my dermatology or OB/GYN clinic?` / `Yes. The core (branches, roles, permissions, patient files and the log) works for every specialty today, and your specialty's sections are added on top.`

### Act 8. The door opens (close). Feeling: resolution, invitation

Full-bleed `close.webp` (golden hour, open door), `140vh` with a gentle pin: the image settles from scale 1.06 to 1 while a frosted plate on the inline-start side resolves. The page ENDS here (it does not fade into a footer).

- h2 ar `لنفتح الباب الصحيح لعيادتك.` en `Let's open the right door for your clinic.`
- p ar `عرض قصير مع فريقنا. بعده نجهز عيادتك وفروعها، ونرسل الدعوة لمدير العيادة.` en `A short walkthrough with our team. Then we set up your clinic and its branches to serve your patients and clients, and invite your clinic admin.`
- The primary button **احجز عرضًا / Book a demo** (larger here), plus the email as plain text.
  Footer under it, small and quiet: lockup, `© 2026 Eyadex`, language link, Sign in link.

### Book a demo behaviour

`src/marketing/site-config.ts`:

```ts
export const SITE = {
  url: "https://eyadex.com",
  whatsapp: "", // TODO(spec): owner to supply, international format without +, e.g. 9655xxxxxxx
  email: "hello@eyadex.com", // TODO(spec): confirm
};
```

Every Book a demo button opens `https://wa.me/{whatsapp}?text=...` (prefilled ar: `مرحبًا، أرغب بحجز عرض لـ Eyadex لعيادتي.` en: `Hello, I'd like to book an Eyadex demo for my clinic.`) in a new tab when `whatsapp` is set, otherwise a `mailto:` with the same text as subject. No form, nothing stored.

---

## 6. Accessibility and states

- Every control: hover, focus-visible, active, disabled. Button labels one line on desktop.
- Contrast measured on the render: body ≥ 4.5:1, large ≥ 3:1, on top of the frosted glass over the brightest video frame. Increase frost opacity locally if needed, never add a full-frame overlay.
- Reduced motion keeps meaning: no pins, no scrub, no slides; opacity fades only; Keyring still works by click/tap/keyboard; the floor plan renders fully drawn.
- Tab order follows reading order in both directions. Skip link "تخطَّ إلى المحتوى / Skip to content".
- Decorative images `alt=""`; meaningful ones (keys) are labelled by their buttons.

## 7. Files and limits

- `src/marketing/` with one component per file (max 300 lines): `marketing-page.tsx`, `marketing-nav.tsx`, `hero-room.tsx`, `truth-act.tsx`, `keyring/keyring-act.tsx`, `keyring/keyring-window.tsx`, `keyring/keyring-model.ts`, `plan-drawing.tsx`, `corridor-act.tsx`, `language-act.tsx`, `roadmap-act.tsx`, `faq-act.tsx`, `close-act.tsx`, `marketing-footer.tsx`, `motion/*.ts`, `seo/*.ts`, `i18n/{ar,en}.ts`, `site-config.ts`, `marketing.css`. Banned folder names still apply.
- Add a vitest file for `keyring-model.ts` (team key sees nothing; doctor sees only Salmiya rows; buttons follow ROLE_TEMPLATES).

## 8. Acceptance (check before you stop, in Arabic and English, 1440px and 390px)

1. View source of `/` and `/en`: correct `<html lang dir>`, title, description, canonical, hreflang, OG, JSON-LD, the H1 and all section text present in the server HTML.
2. `/login` shows the persona sign-in; sign-out returns there; app routes are noindex.
3. Hero: opening frame readable; mid-scroll the door is half open and the video has advanced; end state shows the second beat over the clear room. Mobile composition is its own.
4. Keyring: each key changes rows, sidebar, buttons and caption; the team key frosts everything and stamps the refusal; ledger lines appear only for keys that can view.
5. Reduced-motion run is complete and readable. No console errors. No horizontal overflow.
6. `robots.txt`, `sitemap.xml`, `llms.txt`, `site.webmanifest`, icons and OG images resolve.
   Then update `roadmap.md` (marketing page: done) and stop. Report what you verified and what you could not.
