# 代码块着色

```rust
// 注释
fn main() -> i32 {
    let total = 42;
    println!("hello", total);
}
```

```typescript
const limit: number = 42;
export function greet(name: string): string {
  return `hello ${name}`;
}
```

```python
def greet(name: str) -> str:
    # 注释
    return f"hello {name}"
```

```bash
set -e
echo "hello" | wc -l
```

```json
{"name": "lumir", "count": 3}
```

```text
fenced code -- source stays literal
```

```
no info string stays plain
```

着色不得溢出到代码块之外。
