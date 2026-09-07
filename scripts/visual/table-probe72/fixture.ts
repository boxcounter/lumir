export const small = `Before sentinel72

| Default | Left | Center | Right |
| --- | :--- | :---: | ---: |
| alpha || middle | 123 |
| escaped \\| pipe | left | center | 987 |

Between sentinel72

> | Quote | Value |
> | --- | ---: |
> | nested | 42 |

- parent

  | List | Value |
  | --- | --- |
  | nested | retained |

A | B
--- | ---
one | two

| Invalid | Shape |
| --- | --- |
| extra | cell | preserved |

- [ ] readonly task

After sentinel72
`;
export const large = 'Large table sentinel72\n\n| First | Empty | Third | Last |\n|---|---|---|---|\n' + Array.from({length: 14000}, (_, i) => `| row${i} ${'long source '.repeat(3)} | | middle${i} | last${i} |`).join('\n') + '\n\nEnd sentinel72';
