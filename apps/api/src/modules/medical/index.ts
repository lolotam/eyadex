// The only file other modules may import (CLAUDE.architecture.md §2.1).
export { MedicalModule } from "./medical.module.ts";
// The ICD-10-CM loader command (cli/load-icd10.ts) reads the CDC file with the module's own parser.
export { ICD10_RELEASE, parseIcd10OrderFile, type Icd10Row } from "./domain/icd10.ts";
