export const wordPrefix = "u:urn:e:";
export function wordId(uri) {
  return uri.slice(wordPrefix.length).split("#")[0];
}
