import * as logtape from "@logtape/logtape";

await logtape.configure({
  sinks: {
    console: logtape.getConsoleSink({
      formatter: logtape.getAnsiColorFormatter({
        level: "full",
        categoryColor: "cyan",
      }),
    }),
  },
  loggers: [
    {
      category: "app",
      lowestLevel: "info",
      sinks: ["console"],
    },

    {
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["console"],
    },
  ],
});

export const appLogger = logtape.getLogger("app");
