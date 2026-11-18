export interface Example {
  id: string;
  title: string;
  code: string;
  /** Default program input (System.in) for examples that read with Scanner. */
  input?: string;
}

export const EXAMPLES: Example[] = [
  {
    id: 'basics',
    title: 'Primitives vs references',
    code: `public class Main {
    public static void main(String[] args) {
        int age = 25;           // primitive: value lives in the frame
        double price = 9.99;
        boolean ok = true;
        char grade = 'A';

        Person p = new Person(); // reference: frame holds an address
        p.age = age;             // the int is copied into the object
        p.name = "Ana";

        int copy = age;          // copies the value
        copy = 99;               // age is unchanged
        System.out.println(age + " " + copy);
    }
}

class Person {
    String name;
    int age;
}
`,
  },
  {
    id: 'aliasing',
    title: 'Aliasing (two references, one object)',
    code: `public class Main {
    public static void main(String[] args) {
        Person p = new Person("Ana", 20);
        Person q = p;      // copies the address, not the object
        q.age = 30;        // changes the object both point to
        System.out.println(p.age);

        Person r = new Person("Ana", 30);
        System.out.println(p == q);   // same address
        System.out.println(p == r);   // different objects
    }
}

class Person {
    String name;
    int age;

    Person(String name, int age) {
        this.name = name;
        this.age = age;
    }
}
`,
  },
  {
    id: 'pass-by-value',
    title: 'Pass-by-value (swap)',
    code: `public class Main {
    static void swap(int a, int b) {
        int tmp = a;
        a = b;
        b = tmp;
    }

    static void swapPeople(Person a, Person b) {
        Person tmp = a;
        a = b;            // only the local copies change
        b = tmp;
    }

    static void birthday(Person p) {
        p.age++;          // follows the copied address to the real object
    }

    public static void main(String[] args) {
        int x = 1;
        int y = 2;
        swap(x, y);
        System.out.println(x + ", " + y);   // 1, 2

        Person ana = new Person();
        Person bob = new Person();
        swapPeople(ana, bob);   // ana and bob still point to the same objects

        birthday(ana);
        System.out.println(ana.age);        // 1
    }
}

class Person {
    int age;
}
`,
  },
  {
    id: 'arrays',
    title: 'Arrays of primitives vs objects',
    code: `public class Main {
    public static void main(String[] args) {
        int[] nums = new int[3];      // elements default to 0
        nums[0] = 10;
        nums[2] = nums[0] * 2;

        int[] same = nums;            // arrays are objects, so this copies the reference
        same[1] = 5;

        Point[] pts = new Point[2];   // elements default to null
        pts[0] = new Point(1, 2);
        pts[1] = pts[0];              // both slots reference one Point

        int[][] grid = {{1, 2}, {3, 4}};
        System.out.println(nums[1] + " " + grid[1][0]);
    }
}

class Point {
    int x;
    int y;

    Point(int x, int y) {
        this.x = x;
        this.y = y;
    }
}
`,
  },
  {
    id: 'strings',
    title: 'String pool: == vs equals',
    code: `public class Main {
    public static void main(String[] args) {
        String a = "hello";             // literal goes into the String pool
        String b = "hello";             // reuses the same pooled object
        String c = new String("hello"); // new object, outside the pool

        System.out.println(a == b);       // true: same address
        System.out.println(a == c);       // false: different objects
        System.out.println(a.equals(c));  // true: same characters

        String d = a + " world";         // concatenation creates a new String
        String e = c.intern();           // pooled copy
        System.out.println(a == e);
    }
}
`,
  },
  {
    id: 'gc',
    title: 'Garbage collection',
    code: `public class Main {
    public static void main(String[] args) {
        Box first = new Box(1);
        Box second = new Box(2);

        first = second;    // Box(1) has no references left, so it becomes garbage
        second = null;     // Box(2) is still reachable through first

        for (int i = 0; i < 3; i++) {
            Box temp = new Box(i);  // each temp is unreachable after its iteration
        }

        first = null;      // now Box(2) is garbage too
        System.out.println("done");
    }
}

class Box {
    int value;

    Box(int value) {
        this.value = value;
    }
}
`,
  },
  {
    id: 'recursion',
    title: 'Recursion and the call stack',
    code: `public class Main {
    static int factorial(int n) {
        if (n <= 1) {
            return 1;
        }
        return n * factorial(n - 1);   // each call gets its own frame and its own n
    }

    public static void main(String[] args) {
        int result = factorial(4);
        System.out.println(result);
    }
}
`,
  },
  {
    id: 'linked-list',
    title: 'Linked list',
    code: `public class Main {
    public static void main(String[] args) {
        Node head = new Node(1);
        head.next = new Node(2);
        head.next.next = new Node(3);

        Node cur = head;
        int sum = 0;
        while (cur != null) {
            sum += cur.value;
            cur = cur.next;
        }
        System.out.println("sum = " + sum);

        head = head.next;   // the first node is no longer reachable
    }
}

class Node {
    int value;
    Node next;

    Node(int value) {
        this.value = value;
    }
}
`,
  },
  {
    id: 'statics',
    title: 'Static vs instance fields',
    code: `public class Main {
    public static void main(String[] args) {
        Counter a = new Counter();
        Counter b = new Counter();
        System.out.println(Counter.total + " " + a.id + " " + b.id);
    }
}

class Counter {
    static int total = 0;   // one copy, stored with the class
    int id;                 // one copy per object, stored on the heap

    Counter() {
        total++;
        id = total;
    }
}
`,
  },
  {
    id: 'scanner',
    title: 'Scanner: reading input',
    input: 'Ana\n20\nLos Angeles\n4 8 15\n',
    code: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);  // heap object that reads System.in

        System.out.print("Name: ");
        String name = sc.nextLine();          // new String on the heap

        System.out.print("Age: ");
        int age = sc.nextInt();               // primitive copied into the frame

        String rest = sc.nextLine();          // pitfall: "" (leftover line break)
        System.out.print("City: ");
        String city = sc.nextLine();

        int sum = 0;
        while (sc.hasNextInt()) {             // peeks without consuming
            sum += sc.nextInt();
        }
        System.out.println(name + " (" + age + ") from " + city + ", sum = " + sum);
        sc.close();
    }
}
`,
  },
  {
    id: 'math',
    title: 'Math library methods',
    code: `public class Main {
    public static void main(String[] args) {
        int a = -7;
        int b = 3;

        int bigger = Math.max(a, b);      // int in, int out
        int dist = Math.abs(a);
        double root = Math.sqrt(16);      // the int 16 becomes the double 16.0
        double power = Math.pow(2, 10);
        long rounded = Math.round(2.5);   // round returns a long
        double area = Math.PI * 2 * 2;    // Math.PI is a static constant

        int dice = (int) (Math.random() * 6) + 1;
        System.out.println(bigger + " " + dist + " " + root + " " + power + " " + rounded);
        System.out.println("area = " + area + ", dice = " + dice);
    }
}
`,
  },
];
