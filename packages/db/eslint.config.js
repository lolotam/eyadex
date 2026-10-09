import config from "@eyadex/config/eslint";

// .drizzle-pull is drizzle-kit's generated scratch output (`db:pull`), never committed.
export default [...config, { ignores: [".drizzle-pull"] }];
