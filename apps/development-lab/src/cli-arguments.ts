export interface DevelopmentCliArguments {
  command: string;
  positional: readonly string[];
}

export function parseDevelopmentCliArguments(argumentsValue: readonly string[]): DevelopmentCliArguments {
  const values = argumentsValue.filter((value) => value !== "--");
  return {
    command: values[0] ?? "status",
    positional: values.slice(1),
  };
}
