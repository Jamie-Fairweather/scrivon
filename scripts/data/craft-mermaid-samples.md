Source URL: https://agents.craft.do/mermaid
Title: mermaid

---

description: Open source diagram rendering library built for the AI era. Ultra-fast, fully themeable, outputs to SVG and ASCII. Supports Flowchart, State, Sequence, Class, and ER diagrams.
title: Beautiful Mermaid
image: https://agents.craft.do/mermaid/og-image.png

---

**Beautiful Mermaid** by Craft

[ Craft AgentsSimply mind-blowing ](https://agents.craft.do) [ Craft DocsAmazing Notes & Docs ](https://craft.do)

Contents

Default Dracula Solarized

16 Themes

Default zinc-light Zinc Dark Tokyo Night Tokyo Storm Tokyo Light Catppuccin Latte Nord Nord Light Dracula GitHub GitHub Dark Solarized Solar Dark One Dark

### Flowchart (24 samples)

1. [1. Simple Flow](#sample-1)
2. [2. Original Node Shapes](#sample-2)
3. [3. Batch 1 Shapes](#sample-3)
4. [4. Batch 2 Shapes](#sample-4)
5. [5. All 12 Flowchart Shapes](#sample-5)
6. [6. All Edge Styles](#sample-6)
7. [7. No-Arrow Edges](#sample-7)
8. [8. Text-Embedded Labels](#sample-8)
9. [9. Bidirectional Arrows](#sample-9)
10. [10. Parallel Links (&)](#sample-10)
11. [11. Chained Edges](#sample-11)
12. [12. linkStyle: Color-Coded Edges](#sample-12)
13. [13. linkStyle: Default + Override](#sample-13)
14. [14. Direction: Left-Right (LR)](#sample-14)
15. [15. Direction: Bottom-Top (BT)](#sample-15)
16. [16. Subgraphs](#sample-16)
17. [17. Nested Subgraphs](#sample-17)
18. [18. Subgraph Direction Override](#sample-18)
19. [19. ::: Class Shorthand](#sample-19)
20. [20. Inline Style Overrides](#sample-20)
21. [21. CI/CD Pipeline](#sample-21)
22. [22. System Architecture](#sample-22)
23. [23. Decision Tree](#sample-23)
24. [24. Git Branching Workflow](#sample-24)

### State (4 samples)

1. [25. Basic State Diagram](#sample-25)
2. [26. Composite States](#sample-26)
3. [27. Connection Lifecycle](#sample-27)
4. [28. CJK State Names](#sample-28)

### Sequence (16 samples)

1. [29. Basic Messages](#sample-29)
2. [30. Participant Aliases](#sample-30)
3. [31. Actor Stick Figures](#sample-31)
4. [32. Arrow Types](#sample-32)
5. [33. Activation Boxes](#sample-33)
6. [34. Self-Messages](#sample-34)
7. [35. Loop Block](#sample-35)
8. [36. Alt/Else Block](#sample-36)
9. [37. Opt Block](#sample-37)
10. [38. Par Block](#sample-38)
11. [39. Critical Block](#sample-39)
12. [40. Notes (Right/Left/Over)](#sample-40)
13. [41. OAuth 2.0 Flow](#sample-41)
14. [42. Database Transaction](#sample-42)
15. [43. Microservice Orchestration](#sample-43)
16. [44. Self-Messages with Notes](#sample-44)

### Class (16 samples)

1. [45. Basic Class](#sample-45)
2. [46. Visibility Markers](#sample-46)
3. [47. Interface Annotation](#sample-47)
4. [48. Abstract Annotation](#sample-48)
5. [49. Enum Annotation](#sample-49)
6. [50. Inheritance (<|--)](#sample-50)
7. [51. Composition (\*--)](#sample-51)
8. [52. Aggregation (o--)](#sample-52)
9. [53. Association (-->)](#sample-53)
10. [54. Dependency (..>)](#sample-54)
11. [55. Realization (..|>)](#sample-55)
12. [56. All 6 Relationship Types](#sample-56)
13. [57. Relationship Labels](#sample-57)
14. [58. Design Pattern — Observer](#sample-58)
15. [59. MVC Architecture](#sample-59)
16. [60. Full Hierarchy](#sample-60)

### ER (14 samples)

1. [61. Basic Relationship](#sample-61)
2. [62. Entity with Attributes](#sample-62)
3. [63. Attribute Keys (PK, FK, UK)](#sample-63)
4. [64. Exactly One to Exactly One (||--||)](#sample-64)
5. [65. Exactly One to Zero-or-Many (||--o{)](#sample-65)
6. [66. Zero-or-One to One-or-Many (|o--|{)](#sample-66)
7. [67. One-or-More to Zero-or-Many (}|--o{)](#sample-67)
8. [68. All Cardinality Types](#sample-68)
9. [69. Identifying (Solid) Relationship](#sample-69)
10. [70. Non-Identifying (Dashed) Relationship](#sample-70)
11. [71. Mixed Identifying & Non-Identifying](#sample-71)
12. [72. E-Commerce Schema](#sample-72)
13. [73. Blog Platform Schema](#sample-73)
14. [74. School Management Schema](#sample-74)

### XY Chart (10 samples)

1. [75. Simple Bar Chart](#sample-75)
2. [76. Line Chart](#sample-76)
3. [77. Bar and Line Overlay](#sample-77)
4. [78. Horizontal Bars](#sample-78)
5. [79. Multiple Bar Series](#sample-79)
6. [80. Dual Lines](#sample-80)
7. [81. Numeric X-Axis](#sample-81)
8. [82. 12-Month Dataset](#sample-82)
9. [83. Horizontal Combined](#sample-83)
10. [84. Sprint Burndown](#sample-84)

## Samples

## Simple Flow

Basic linear flow with three nodes connected by solid arrows.

```
graph TD
  A[Start] --> B[Process] --> C[End]
```

Edit

```
Rendering…
```

## Original Node Shapes

Rectangle, rounded, diamond, stadium, and circle.

```
graph LR
  A[Rectangle] --> B(Rounded)
  B --> C{Diamond}
  C --> D([Stadium])
  D --> E((Circle))
```

Edit

```
Rendering…
```

## Batch 1 Shapes

Subroutine `[[text]]`, double circle `(((text)))`, and hexagon `{{text}}`.

```
graph LR
  A[[Subroutine]] --> B(((Double Circle)))
  B --> C{{Hexagon}}
```

Edit

```
Rendering…
```

## Batch 2 Shapes

Cylinder `[(text)]`, asymmetric `>text]`, trapezoid `[/text\]`, and inverse trapezoid `[\text/]`.

```
graph LR
  A[(Database)] --> B>Flag Shape]
  B --> C[/Wider Bottom\]
  C --> D[\Wider Top/]
```

Edit

```
Rendering…
```

## All 12 Flowchart Shapes

Every supported flowchart shape in a single diagram.

```
graph LR
  A[Rectangle] --> B(Rounded)
  B --> C{Diamond}
  C --> D([Stadium])
  D --> E((Circle))
  E --> F[[Subroutine]]
  F --> G(((Double Circle)))
  G --> H{{Hexagon}}
  H --> I[(Database)]
  I --> J>Flag]
  J --> K[/Trapezoid\]
  K --> L[\Inverse Trap/]
```

Edit

```
Rendering…
```

## All Edge Styles

Solid, dotted, and thick arrows with labels.

```
graph TD
  A[Source] -->|solid| B[Target 1]
  A -.->|dotted| C[Target 2]
  A ==>|thick| D[Target 3]
```

Edit

```
Rendering…
```

## No-Arrow Edges

Lines without arrowheads: solid `---`, dotted `-.-`, thick `===`.

```
graph TD
  A[Node 1] ---|related| B[Node 2]
  B -.- C[Node 3]
  C === D[Node 4]
```

Edit

```
Rendering…
```

## Text-Embedded Labels

Using `-- label -->` syntax instead of `-->|label|` for edge labels.

```
flowchart TD
  A(Start) --> B{Is it sunny?}
  B -- Yes --> C[Go to the park]
  B -- No --> D[Stay indoors]
  C --> E[Finish]
  D --> E
```

Edit

```
Rendering…
```

## Bidirectional Arrows

Arrows in both directions: `<-->`, `<-.->`, `<==>`.

```
graph LR
  A[Client] <-->|sync| B[Server]
  B <-.->|heartbeat| C[Monitor]
  C <==>|data| D[Storage]
```

Edit

```
Rendering…
```

## Parallel Links (&)

Using `&` to create multiple edges from/to groups of nodes.

```
graph TD
  A[Input] & B[Config] --> C[Processor]
  C --> D[Output] & E[Log]
```

Edit

```
Rendering…
```

## Chained Edges

A long chain of nodes demonstrating edge chaining syntax.

```
graph LR
  A[Step 1] --> B[Step 2] --> C[Step 3] --> D[Step 4] --> E[Step 5]
```

Edit

```
Rendering…
```

## linkStyle: Color-Coded Edges

Using `linkStyle` to color specific edges by index (0-based).

```
graph TD
  A[Start] --> B{Decision}
  B -->|Yes| C[Accept]
  B -->|No| D[Reject]
  C --> E[Done]
  D --> E
  linkStyle 0 stroke:#7aa2f7,stroke-width:3px
  linkStyle 1 stroke:#9ece6a,stroke-width:2px
  linkStyle 2 stroke:#f7768e,stroke-width:2px
  linkStyle default stroke:#565f89
```

Edit

```
Rendering…
```

## linkStyle: Default + Override

Default edge style with index-specific overrides for critical paths.

```
graph LR
  A[Request] --> B[Auth]
  B --> C[Process]
  C --> D[Response]
  B --> E[Reject]
  linkStyle default stroke:#6b7280,stroke-width:1px
  linkStyle 0,1,2 stroke:#22c55e,stroke-width:2px
  linkStyle 3 stroke:#ef4444,stroke-width:3px
```

Edit

```
Rendering…
```

## Direction: Left-Right (LR)

Horizontal layout flowing left to right.

```
graph LR
  A[Input] --> B[Transform] --> C[Output]
```

Edit

```
Rendering…
```

## Direction: Bottom-Top (BT)

Vertical layout flowing from bottom to top.

```
graph BT
  A[Foundation] --> B[Layer 2] --> C[Top]
```

Edit

```
Rendering…
```

## Subgraphs

Grouped nodes inside labeled subgraph containers.

```
graph TD
  subgraph Frontend
    A[React App] --> B[State Manager]
  end
  subgraph Backend
    C[API Server] --> D[Database]
  end
  B --> C
```

Edit

```
Rendering…
```

## Nested Subgraphs

Subgraphs inside subgraphs for hierarchical grouping.

```
graph TD
  subgraph Cloud
    subgraph us-east [US East Region]
      A[Web Server] --> B[App Server]
    end
    subgraph us-west [US West Region]
      C[Web Server] --> D[App Server]
    end
  end
  E[Load Balancer] --> A
  E --> C
```

Edit

```
Rendering…
```

## Subgraph Direction Override

Using `direction LR` inside a subgraph while the outer graph flows TD.

```
graph TD
  subgraph pipeline [Processing Pipeline]
    direction LR
    A[Input] --> B[Parse] --> C[Transform] --> D[Output]
  end
  E[Source] --> A
  D --> F[Sink]
```

Edit

```
Rendering…
```

## ::: Class Shorthand

Assigning classes with `:::` syntax directly on node definitions.

```
graph TD
  A[Normal]:::default --> B[Highlighted]:::highlight --> C[Error]:::error
  classDef default fill:#f4f4f5,stroke:#a1a1aa
  classDef highlight fill:#fbbf24,stroke:#d97706
  classDef error fill:#ef4444,stroke:#dc2626
```

Edit

```
Rendering…
```

## Inline Style Overrides

Using `style` statements to override node fill and stroke colors.

```
graph TD
  A[Default] --> B[Custom Colors] --> C[Another Custom]
  style B fill:#3b82f6,stroke:#1d4ed8,color:#ffffff
  style C fill:#10b981,stroke:#059669
```

Edit

```
Rendering…
```

## CI/CD Pipeline

A realistic CI/CD pipeline with decision points, feedback loops, and deployment stages.

```
graph TD
  subgraph ci [CI Pipeline]
    A[Push Code] --> B{Tests Pass?}
    B -->|Yes| C[Build Image]
    B -->|No| D[Fix & Retry]
    D -.-> A
  end
  C --> E([Deploy Staging])
  E --> F{QA Approved?}
  F -->|Yes| G((Production))
  F -->|No| D
```

Edit

```
Rendering…
```

## System Architecture

A microservices architecture with multiple services and data stores.

```
graph LR
  subgraph clients [Client Layer]
    A([Web App]) --> B[API Gateway]
    C([Mobile App]) --> B
  end
  subgraph services [Service Layer]
    B --> D[Auth Service]
    B --> E[User Service]
    B --> F[Order Service]
  end
  subgraph data [Data Layer]
    D --> G[(Auth DB)]
    E --> H[(User DB)]
    F --> I[(Order DB)]
    F --> J([Message Queue])
  end
```

Edit

```
Rendering…
```

## Decision Tree

A branching decision flowchart with multiple outcomes.

```
graph TD
  A{Is it raining?} -->|Yes| B{Have umbrella?}
  A -->|No| C([Go outside])
  B -->|Yes| D([Go with umbrella])
  B -->|No| E{Is it heavy?}
  E -->|Yes| F([Stay inside])
  E -->|No| G([Run for it])
```

Edit

```
Rendering…
```

## Git Branching Workflow

A git flow showing feature branches, PRs, and release cycle.

```
graph LR
  A[main] --> B[develop]
  B --> C[feature/auth]
  B --> D[feature/ui]
  C --> E{PR Review}
  D --> E
  E -->|approved| B
  B --> F[release/1.0]
  F --> G{Tests?}
  G -->|pass| A
  G -->|fail| F
```

Edit

```
Rendering…
```

## Basic State Diagram

A simple `stateDiagram-v2` with start/end pseudostates and transitions.

```
stateDiagram-v2
  [*] --> Idle
  Idle --> Active : start
  Active --> Idle : cancel
  Active --> Done : complete
  Done --> [*]
```

Edit

```
Rendering…
```

## State: Composite States

Nested composite states with inner transitions.

```
stateDiagram-v2
  [*] --> Idle
  Idle --> Processing : submit
  state Processing {
    parse --> validate
    validate --> execute
  }
  Processing --> Complete : done
  Processing --> Error : fail
  Error --> Idle : retry
  Complete --> [*]
```

Edit

```
Rendering…
```

## State: Connection Lifecycle

TCP-like connection state machine with multiple states.

```
stateDiagram-v2
  [*] --> Closed
  Closed --> Connecting : connect
  Connecting --> Connected : success
  Connecting --> Closed : timeout
  Connected --> Disconnecting : close
  Connected --> Reconnecting : error
  Reconnecting --> Connected : success
  Reconnecting --> Closed : max_retries
  Disconnecting --> Closed : done
  Closed --> [*]
```

Edit

```
Rendering…
```

## State: CJK State Names

State diagram using Chinese characters for state names.

```
stateDiagram-v2
  [*] --> 空闲
  空闲 --> 处理中 : 提交
  处理中 --> 完成 : 成功
  处理中 --> 错误 : 失败
  错误 --> 空闲 : 重试
  完成 --> [*]
```

Edit

```
Rendering…
```

## Sequence: Basic Messages

Simple request/response between two participants.

```
sequenceDiagram
  Alice->>Bob: Hello Bob!
  Bob-->>Alice: Hi Alice!
```

Edit

```
Rendering…
```

## Sequence: Participant Aliases

Using `participant ... as ...` for compact diagram IDs with readable labels.

```
sequenceDiagram
  participant A as Alice
  participant B as Bob
  participant C as Charlie
  A->>B: Hello
  B->>C: Forward
  C-->>A: Reply
```

Edit

```
Rendering…
```

## Sequence: Actor Stick Figures

Using `actor` instead of `participant` renders stick figures instead of boxes.

```
sequenceDiagram
  actor U as User
  participant S as System
  participant DB as Database
  U->>S: Click button
  S->>DB: Query
  DB-->>S: Results
  S-->>U: Display
```

Edit

```
Rendering…
```

## Sequence: Arrow Types

All arrow types: solid `->>` and dashed `-->>` with filled arrowheads, open arrows `-)` .

```
sequenceDiagram
  A->>B: Solid arrow (sync)
  B-->>A: Dashed arrow (return)
  A-)B: Open arrow (async)
  B--)A: Open dashed arrow
```

Edit

```
Rendering…
```

## Sequence: Activation Boxes

Using `+` and `-` to show when participants are active.

```
sequenceDiagram
  participant C as Client
  participant S as Server
  C->>+S: Request
  S->>+S: Process
  S->>-S: Done
  S-->>-C: Response
```

Edit

```
Rendering…
```

## Sequence: Self-Messages

A participant sending a message to itself (displayed as a loop arrow).

```
sequenceDiagram
  participant S as Server
  S->>S: Internal process
  S->>S: Validate
  S-->>S: Log
```

Edit

```
Rendering…
```

## Sequence: Loop Block

A `loop` construct wrapping repeated message exchanges.

```
sequenceDiagram
  participant C as Client
  participant S as Server
  C->>S: Connect
  loop Every 30s
    C->>S: Heartbeat
    S-->>C: Ack
  end
  C->>S: Disconnect
```

Edit

```
Rendering…
```

## Sequence: Alt/Else Block

Conditional branching with `alt` (if) and `else` blocks.

```
sequenceDiagram
  participant C as Client
  participant S as Server
  C->>S: Login
  alt Valid credentials
    S-->>C: 200 OK
  else Invalid
    S-->>C: 401 Unauthorized
  else Account locked
    S-->>C: 403 Forbidden
  end
```

Edit

```
Rendering…
```

## Sequence: Opt Block

Optional block — executes only if condition is met.

```
sequenceDiagram
  participant A as App
  participant C as Cache
  participant DB as Database
  A->>C: Get data
  C-->>A: Cache miss
  opt Cache miss
    A->>DB: Query
    DB-->>A: Results
    A->>C: Store in cache
  end
```

Edit

```
Rendering…
```

## Sequence: Par Block

Parallel execution with `par`/`and` constructs.

```
sequenceDiagram
  participant C as Client
  participant A as AuthService
  participant U as UserService
  participant O as OrderService
  C->>A: Authenticate
  par Fetch user data
    A->>U: Get profile
  and Fetch orders
    A->>O: Get orders
  end
  A-->>C: Combined response
```

Edit

```
Rendering…
```

## Sequence: Critical Block

Critical section that must complete atomically.

```
sequenceDiagram
  participant A as App
  participant DB as Database
  A->>DB: BEGIN
  critical Transaction
    A->>DB: UPDATE accounts
    A->>DB: INSERT log
  end
  A->>DB: COMMIT
```

Edit

```
Rendering…
```

## Sequence: Notes (Right/Left/Over)

Notes positioned to the right, left, or over participants.

```
sequenceDiagram
  participant A as Alice
  participant B as Bob
  Note left of A: Alice prepares
  A->>B: Hello
  Note right of B: Bob thinks
  B-->>A: Reply
  Note over A,B: Conversation complete
```

Edit

```
Rendering…
```

## Sequence: OAuth 2.0 Flow

Full OAuth 2.0 authorization code flow with token exchange.

```
sequenceDiagram
  actor U as User
  participant App as Client App
  participant Auth as Auth Server
  participant API as Resource API
  U->>App: Click Login
  App->>Auth: Authorization request
  Auth->>U: Login page
  U->>Auth: Credentials
  Auth-->>App: Authorization code
  App->>Auth: Exchange code for token
  Auth-->>App: Access token
  App->>API: Request + token
  API-->>App: Protected resource
  App-->>U: Display data
```

Edit

```
Rendering…
```

## Sequence: Database Transaction

Multi-step database transaction with rollback handling.

```
sequenceDiagram
  participant C as Client
  participant S as Server
  participant DB as Database
  C->>S: POST /transfer
  S->>DB: BEGIN
  S->>DB: Debit account A
  alt Success
    S->>DB: Credit account B
    S->>DB: INSERT audit_log
    S->>DB: COMMIT
    S-->>C: 200 OK
  else Insufficient funds
    S->>DB: ROLLBACK
    S-->>C: 400 Bad Request
  end
```

Edit

```
Rendering…
```

## Sequence: Microservice Orchestration

Complex multi-service flow with parallel calls and error handling.

```
sequenceDiagram
  participant G as Gateway
  participant A as Auth
  participant U as Users
  participant O as Orders
  participant N as Notify
  G->>A: Validate token
  A-->>G: Valid
  par Fetch data
    G->>U: Get user
    U-->>G: User data
  and
    G->>O: Get orders
    O-->>G: Order list
  end
  G->>N: Send notification
  N-->>G: Queued
  Note over G: Aggregate response
```

Edit

```
Rendering…
```

## Sequence: Self-Messages with Notes

Self-referencing messages inside alt blocks with notes — tests that notes clear self-message loops and stack without overlapping.

```
sequenceDiagram
  participant User
  participant Main as Main Process
  participant Renderer
  participant Timer as 3s Fallback Timer
  User->>Main: CMD+W
  Main->>Main: event.preventDefault()
  Main->>Renderer: WINDOW_CLOSE_REQUESTED
  Main->>Timer: Start 3s timer
  alt Multiple panels
    Renderer->>Renderer: closePanel(focusedId)
    Note over Renderer: Panel removed
    Note over Renderer: No confirmCloseWindow!
    Timer-->>Main: 3s elapsed → window.destroy()
  else Single panel
    Renderer->>Renderer: closePanel(lastId)
    Note over Renderer: Stack becomes []
    Renderer->>Renderer: Auto-select fires → new panel created!
    Note over Renderer: Panel reopens
    Timer-->>Main: 3s elapsed → window.destroy()
  end
```

Edit

```
Rendering…
```

## Class: Basic Class

A single class with attributes and methods, rendered as a 3-compartment box.

```
classDiagram
  class Animal {
    +String name
    +int age
    +eat() void
    +sleep() void
  }
```

Edit

```
Rendering…
```

## Class: Visibility Markers

All four visibility levels: `+` (public), `-` (private), `#` (protected), `~` (package).

```
classDiagram
  class User {
    +String name
    -String password
    #int internalId
    ~String packageField
    +login() bool
    -hashPassword() String
    #validate() void
    ~notify() void
  }
```

Edit

```
Rendering…
```

## Class: Interface Annotation

Using <\> annotation above the class name.

```
classDiagram
  class Serializable {
    <<interface>>
    +serialize() String
    +deserialize(data) void
  }
```

Edit

```
Rendering…
```

## Class: Abstract Annotation

Using <\> annotation for abstract classes.

```
classDiagram
  class Shape {
    <<abstract>>
    +String color
    +area() double
    +draw() void
  }
```

Edit

```
Rendering…
```

## Class: Enum Annotation

Using <\> annotation for enum types.

```
classDiagram
  class Status {
    <<enumeration>>
    ACTIVE
    INACTIVE
    PENDING
    DELETED
  }
```

Edit

```
Rendering…
```

## Class: Inheritance (<|--)

Inheritance relationship rendered with a hollow triangle marker.

```
classDiagram
  class Animal {
    +String name
    +eat() void
  }
  class Dog {
    +String breed
    +bark() void
  }
  class Cat {
    +bool isIndoor
    +meow() void
  }
  Animal <|-- Dog
  Animal <|-- Cat
```

Edit

```
Rendering…
```

## Class: Composition (\*--)

Composition — "owns" relationship with filled diamond marker.

```
classDiagram
  class Car {
    +String model
    +start() void
  }
  class Engine {
    +int horsepower
    +rev() void
  }
  Car *-- Engine
```

Edit

```
Rendering…
```

## Class: Aggregation (o--)

Aggregation — "has" relationship with hollow diamond marker.

```
classDiagram
  class University {
    +String name
  }
  class Department {
    +String faculty
  }
  University o-- Department
```

Edit

```
Rendering…
```

## Class: Association (-->)

Basic association — simple directed arrow.

```
classDiagram
  class Customer {
    +String name
  }
  class Order {
    +int orderId
  }
  Customer --> Order
```

Edit

```
Rendering…
```

## Class: Dependency (..>)

Dependency — dashed line with open arrow.

```
classDiagram
  class Service {
    +process() void
  }
  class Repository {
    +find() Object
  }
  Service ..> Repository
```

Edit

```
Rendering…
```

## Class: Realization (..|>)

Realization — dashed line with hollow triangle (implements interface).

```
classDiagram
  class Flyable {
    <<interface>>
    +fly() void
  }
  class Bird {
    +fly() void
    +sing() void
  }
  Bird ..|> Flyable
```

Edit

```
Rendering…
```

## Class: All 6 Relationship Types

Every relationship type in a single diagram for comparison.

```
classDiagram
  A <|-- B : inheritance
  C *-- D : composition
  E o-- F : aggregation
  G --> H : association
  I ..> J : dependency
  K ..|> L : realization
```

Edit

```
Rendering…
```

## Class: Relationship Labels

Labeled relationships between classes with descriptive text.

```
classDiagram
  class Teacher {
    +String name
  }
  class Student {
    +String name
  }
  class Course {
    +String title
  }
  Teacher --> Course : teaches
  Student --> Course : enrolled in
```

Edit

```
Rendering…
```

## Class: Design Pattern — Observer

The Observer (publish-subscribe) design pattern with interface + concrete implementations.

```
classDiagram
  class Subject {
    <<interface>>
    +attach(Observer) void
    +detach(Observer) void
    +notify() void
  }
  class Observer {
    <<interface>>
    +update() void
  }
  class EventEmitter {
    -List~Observer~ observers
    +attach(Observer) void
    +detach(Observer) void
    +notify() void
  }
  class Logger {
    +update() void
  }
  class Alerter {
    +update() void
  }
  Subject <|.. EventEmitter
  Observer <|.. Logger
  Observer <|.. Alerter
  EventEmitter --> Observer
```

Edit

```
Rendering…
```

## Class: MVC Architecture

Model-View-Controller pattern showing relationships between layers.

```
classDiagram
  class Model {
    -data Map
    +getData() Map
    +setData(key, val) void
    +notify() void
  }
  class View {
    -model Model
    +render() void
    +update() void
  }
  class Controller {
    -model Model
    -view View
    +handleInput(event) void
    +updateModel(data) void
  }
  Controller --> Model : updates
  Controller --> View : refreshes
  View --> Model : reads
  Model ..> View : notifies
```

Edit

```
Rendering…
```

## Class: Full Hierarchy

A complete class hierarchy with abstract base, interfaces, and concrete classes.

```
classDiagram
  class Animal {
    <<abstract>>
    +String name
    +int age
    +eat() void
    +sleep() void
  }
  class Mammal {
    +bool warmBlooded
    +nurse() void
  }
  class Bird {
    +bool canFly
    +layEggs() void
  }
  class Dog {
    +String breed
    +bark() void
  }
  class Cat {
    +bool isIndoor
    +purr() void
  }
  class Parrot {
    +String vocabulary
    +speak() void
  }
  Animal <|-- Mammal
  Animal <|-- Bird
  Mammal <|-- Dog
  Mammal <|-- Cat
  Bird <|-- Parrot
```

Edit

```
Rendering…
```

## ER: Basic Relationship

A simple one-to-many relationship between two entities.

```
erDiagram
  CUSTOMER ||--o{ ORDER : places
```

Edit

```
Rendering…
```

## ER: Entity with Attributes

An entity with typed attributes and `PK`/`FK`/`UK` key badges.

```
erDiagram
  CUSTOMER {
    int id PK
    string name
    string email UK
    date created_at
  }
```

Edit

```
Rendering…
```

## ER: Attribute Keys (PK, FK, UK)

All three key constraint types rendered as badges.

```
erDiagram
  ORDER {
    int id PK
    int customer_id FK
    string invoice_number UK
    decimal total
    date order_date
    string status
  }
```

Edit

```
Rendering…
```

## ER: Exactly One to Exactly One (||--||)

One-to-one mandatory relationship.

```
erDiagram
  PERSON ||--|| PASSPORT : has
```

Edit

```
Rendering…
```

## ER: Exactly One to Zero-or-Many (||--o{)

Classic one-to-many optional relationship (crow's foot).

```
erDiagram
  CUSTOMER ||--o{ ORDER : places
```

Edit

```
Rendering…
```

## ER: Zero-or-One to One-or-Many (|o--|{)

Optional on one side, at-least-one on the other.

```
erDiagram
  SUPERVISOR |o--|{ EMPLOYEE : manages
```

Edit

```
Rendering…
```

## ER: One-or-More to Zero-or-Many (}|--o{)

At-least-one to zero-or-many relationship.

```
erDiagram
  TEACHER }|--o{ COURSE : teaches
```

Edit

```
Rendering…
```

## ER: All Cardinality Types

Every cardinality combination in one diagram.

```
erDiagram
  A ||--|| B : one-to-one
  C ||--o{ D : one-to-many
  E |o--|{ F : opt-to-many
  G }|--o{ H : many-to-many
```

Edit

```
Rendering…
```

## ER: Identifying (Solid) Relationship

Solid line indicating an identifying relationship (child depends on parent for identity).

```
erDiagram
  ORDER ||--|{ LINE_ITEM : contains
```

Edit

```
Rendering…
```

## ER: Non-Identifying (Dashed) Relationship

Dashed line indicating a non-identifying relationship.

```
erDiagram
  USER ||..o{ LOG_ENTRY : generates
  USER ||..o{ SESSION : opens
```

Edit

```
Rendering…
```

## ER: Mixed Identifying & Non-Identifying

Both solid and dashed lines in the same diagram.

```
erDiagram
  ORDER ||--|{ LINE_ITEM : contains
  ORDER ||..o{ SHIPMENT : ships-via
  PRODUCT ||--o{ LINE_ITEM : includes
  PRODUCT ||..o{ REVIEW : receives
```

Edit

```
Rendering…
```

## ER: E-Commerce Schema

Full e-commerce database schema with customers, orders, products, and line items.

```
erDiagram
  CUSTOMER {
    int id PK
    string name
    string email UK
  }
  ORDER {
    int id PK
    date created
    int customer_id FK
  }
  PRODUCT {
    int id PK
    string name
    float price
  }
  LINE_ITEM {
    int id PK
    int order_id FK
    int product_id FK
    int quantity
  }
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  PRODUCT ||--o{ LINE_ITEM : includes
```

Edit

```
Rendering…
```

## ER: Blog Platform Schema

Blog system with users, posts, comments, and tags.

```
erDiagram
  USER {
    int id PK
    string username UK
    string email UK
    date joined
  }
  POST {
    int id PK
    string title
    text content
    int author_id FK
    date published
  }
  COMMENT {
    int id PK
    text body
    int post_id FK
    int user_id FK
    date created
  }
  TAG {
    int id PK
    string name UK
  }
  USER ||--o{ POST : writes
  USER ||--o{ COMMENT : authors
  POST ||--o{ COMMENT : has
  POST }|--o{ TAG : tagged-with
```

Edit

```
Rendering…
```

## ER: School Management Schema

School system with students, teachers, courses, and enrollments.

```
erDiagram
  STUDENT {
    int id PK
    string name
    date dob
    string grade
  }
  TEACHER {
    int id PK
    string name
    string department
  }
  COURSE {
    int id PK
    string title
    int teacher_id FK
    int credits
  }
  ENROLLMENT {
    int id PK
    int student_id FK
    int course_id FK
    string semester
    float grade
  }
  TEACHER ||--o{ COURSE : teaches
  STUDENT ||--o{ ENROLLMENT : enrolled
  COURSE ||--o{ ENROLLMENT : has
```

Edit

```
Rendering…
```

## XY: Simple Bar Chart

Basic bar chart with categorical x-axis.

```
xychart-beta
    title "Product Sales"
    x-axis [Widgets, Gadgets, Gizmos, Doodads, Thingamajigs]
    bar [150, 230, 180, 95, 310]
```

**Options:** `{"interactive":true}`

Edit

```
Rendering…
```

## XY: Line Chart

Line chart showing revenue growth over years.

```
xychart-beta
    title "Revenue Growth"
    x-axis [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]
    line [320, 420, 540, 680, 820, 950, 1080, 1200]
```

**Options:** `{"interactive":true}`

Edit

```
Rendering…
```

## XY: Bar and Line Overlay

Bars with a line overlay and both axis titles.

```
xychart-beta
    title "Monthly Revenue"
    x-axis "Month" [Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec]
    y-axis "Revenue (USD)" 0 --> 10000
    bar [4200, 5000, 5800, 6200, 5500, 7000, 7800, 7200, 8400, 8100, 9000, 9200]
    line [4200, 5000, 5800, 6200, 5500, 7000, 7800, 7200, 8400, 8100, 9000, 9200]
```

**Options:** `{"interactive":true}`

Edit

```
Rendering…
```

## XY: Horizontal Bars

Horizontal bar chart showing language popularity.

```
xychart-beta horizontal
    title "Language Popularity"
    x-axis [Python, JavaScript, Java, Go, Rust]
    bar [30, 25, 20, 12, 8]
```

**Options:** `{"interactive":true}`

Edit

```
Rendering…
```

## XY: Multiple Bar Series

Two bar series comparing years side by side.

```
xychart-beta
    title "2023 vs 2024 Sales"
    x-axis [Q1, Q2, Q3, Q4]
    bar [200, 250, 300, 280]
    bar [230, 280, 320, 350]
```

**Options:** `{"interactive":true}`

Edit

```
Rendering…
```

## XY: Dual Lines

Two lines comparing planned vs actual values.

```
xychart-beta
    title "Planned vs Actual"
    x-axis [Jan, Feb, Mar, Apr, May, Jun, Jul, Aug]
    line [100, 145, 190, 240, 280, 320, 360, 400]
    line [90, 130, 185, 235, 275, 340, 380, 420]
```

**Options:** `{"interactive":true}`

Edit

```
Rendering…
```

## XY: Numeric X-Axis

Line chart using a numeric x-axis range.

```
xychart-beta
    title "Distribution Curve"
    x-axis 0 --> 100
    line [4, 7, 13, 21, 31, 43, 58, 71, 84, 91, 95, 91, 84, 71, 58, 43, 31, 21, 13, 7, 4]
```

**Options:** `{"interactive":true}`

Edit

```
Rendering…
```

## XY: 12-Month Dataset

Full year monthly data with bar and trend line.

```
xychart-beta
    title "Monthly Active Users (2024)"
    x-axis [Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec]
    y-axis "Users" 0 --> 30000
    bar [12000, 13500, 15200, 16800, 18500, 20100, 19800, 21500, 23000, 24200, 25800, 28000]
    line [12000, 13500, 15200, 16800, 18500, 20100, 19800, 21500, 23000, 24200, 25800, 28000]
```

**Options:** `{"interactive":true}`

Edit

```
Rendering…
```

## XY: Horizontal Combined

Horizontal chart with both bars and a trend line.

```
xychart-beta horizontal
    title "Budget vs Actual"
    x-axis [Eng, Sales, Marketing, Product, Ops, HR, Finance, Legal]
    bar [500, 350, 250, 200, 150, 120, 100, 80]
    line [480, 380, 230, 180, 160, 110, 95, 75]
```

**Options:** `{"interactive":true}`

Edit

```
Rendering…
```

## XY: Sprint Burndown

Sprint burndown chart with actual and ideal lines.

```
xychart-beta
    title "Sprint Burndown"
    x-axis [D1, D2, D3, D4, D5, D6, D7, D8, D9, D10]
    y-axis "Story Points" 0 --> 80
    line [72, 65, 58, 50, 45, 38, 30, 22, 12, 0]
    line [72, 65, 58, 50, 43, 36, 29, 22, 14, 0]
```

**Options:** `{"interactive":true}`

Edit

```
Rendering…
```

Edit Diagram ×

Cancel Save & Render
