# Java Memory Visualizer

Step through a small Java program and watch how the JVM uses memory:

- **Stack**: one frame per method call, holding local variables and parameters. Primitives (`int`, `double`, `boolean`, `char`, …) store their value right in the frame.
- **Heap**: objects, arrays and Strings. Reference variables store only an address, drawn as an arrow.
- **String pool**: string literals are shared, while `new String(...)` creates a separate object.
- **Static fields**: one copy per class, shared by all instances.
- **Garbage collection**: objects nothing can reach are greyed out, then reclaimed on the next step.
- **Java library**: `Scanner` and `Math` calls get their own stack frame (marked "java library"). `System.in` is a static field that references an `InputStream` object, and a `Scanner` object points to it. Type the program's input in the **Program input** box and watch Scanner consume it.

## Run

```bash
npm install
npm run dev      # open the printed URL
npm test         # lexer, parser and interpreter tests
npm run build
```

Keys: `←` `→` step, `Space` play or pause, `Home` `End`.
The memory view is a [React Flow](https://reactflow.dev) canvas:
- **Drag a card by its header** to rearrange it, scroll to zoom, and drag the background to pan.
- Dragged positions are remembered per example, including across reloads.
- **Auto layout** forgets them and arranges the cards again.
- Hover over a card to highlight its arrows.
Link to a specific moment with `#example=<id>&step=<n>`, e.g. `#example=aliasing&step=8`.

## How it works

```
source → lexer → parser → AST → interpreter → Step[] (snapshots) → React UI
```

The interpreter (`src/runtime/interpreter.ts`) runs the whole program up front and records a full memory snapshot plus a plain-language explanation for every step. The UI only renders `steps[i]`, which is why stepping backwards works.

| Path | Purpose |
| --- | --- |
| `src/lang/` | Lexer and recursive-descent parser for a Java subset |
| `src/runtime/` | Values, heap (with String pool), stack frames, mark-and-sweep GC, interpreter |
| `src/ui/` | Editor (CodeMirror), controls, and the memory canvas: `memoryGraph.ts` turns a snapshot into React Flow nodes/edges with a depth-based auto layout, `flow/` has the card and arrow components |
| `src/examples/` | Built-in teaching programs |

## Supported Java subset

`import` and `package` declarations; classes with fields, constructors, and instance and static methods; all 8 primitive types; `String` (common methods); 1-D and multi-dimensional arrays; `if`/`else`, `while`, `for`, `break`, `continue`, `return`; arithmetic with Java's int overflow and integer-division rules; casts; `==` and `equals`; `toString()`; `System.out.println`; `java.util.Scanner` reading `System.in` (`nextInt`, `nextDouble`, `next`, `nextLine`, `hasNext…`, `close`, with `InputMismatchException` and `NoSuchElementException`); `Math` (`abs`, `max`, `min`, `sqrt`, `pow`, `round`, `floor`, `ceil`, `random`, trigonometry, `PI`, `E`, …). Runtime errors are reported as Java would report them: `NullPointerException`, `ArrayIndexOutOfBoundsException`, `ArithmeticException` and `StackOverflowError`.

Not supported (yet): inheritance and interfaces, other `java.util` classes such as `ArrayList`, `HashMap` and `Random`, wrapper classes and autoboxing, exceptions with `try`/`catch`, `switch`, lambdas.
