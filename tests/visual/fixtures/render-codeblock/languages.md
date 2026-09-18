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

```toml
[package]
name = 'lumir'
retries = 3
# 注释
[[hooks]]
event = 'PreToolUse'
enabled = true
since = 1979-05-27
```

```yaml
dimensions:
  - name: Goal                         # 特殊维度：values 来自当月 _monthly.md
    key: goal
    source: monthly

  - name: Business line
    key: business-line
    values:
      - Slax Reader
      - ZSXQ

  - name: Importance/Urgency
    key: importance-urgency
```

```yml
snapshot:
  - name: 类别
    key: category
    values:
      - Important+Urgent
      - Not Important+Not Urgent
```

```text
fenced code -- source stays literal
```

```
no info string stays plain
```

着色不得溢出到代码块之外。
