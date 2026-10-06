# GoldOS Mobile — architecture & conventions

Expo SDK 57 · expo-router (file routes under `src/app`) · TanStack Query · TypeScript strict.
The app is a native client of the same Cloudflare Worker API the web app uses
(`EXPO_PUBLIC_API_URL`, default in `.env`). Every web screen under
`apps/web/app/(app)` has a mobile counterpart with the same features.

## Run

```bash
cd apps/mobile
npm install
npx expo start            # Expo Go / dev client
npx tsc --noEmit          # typecheck (must be clean)
npx expo export -p ios -p android --output-dir <tmp>   # full Metro bundle check
```

Only Expo SDK modules are used (no custom native code), so a development build
(`npx expo run:ios|android`) or EAS (`npx eas-cli build`) works with no extra setup.

## Layout of `src/`

| Path | What |
|---|---|
| `app/_layout.tsx` | Providers (Query, Session, gestures), root stack, global hosts (toast, prompt, scanner) |
| `app/login.tsx` | Sign in |
| `app/(app)/_layout.tsx` | Auth guard + the stack every module screen is pushed onto |
| `app/(app)/(tabs)/` | Native tabs: `home` · `sell` · `scanner` · `catalog` · `more` (each a small stack) |
| `app/(app)/<web path>/index.tsx` | Module routes, **mirroring the web paths** (`/products/[id]`, `/inventory/counts`, …) |
| `features/<module>/` | Screen components and module-local pieces |
| `ui/` | Design system (import everything from `@/ui`) |
| `lib/` | `api`, `session`, `format`, `barcode`, `accounts`, `monthly`, `print`, `haptics`, `count-up`, `nav` |
| `theme/` | Colour tokens (light + dark), Apple type scale, spacing |

`@goldos/shared` (schemas, permissions, units, accounting helpers) is consumed
from `packages/shared/src` through a Metro resolver alias + TS path — not an
npm dependency. The app installs with npm and is excluded from the pnpm workspace.

## Routing rules

* Web `apps/web/app/(app)/X/page.tsx` → mobile `src/app/(app)/X/index.tsx`;
  `X/[id]/page.tsx` → `X/[id]/index.tsx`. Route files are one line:
  `export { default } from "@/features/<module>/<Screen>";`
* Navigate with the **web path**: `router.push("/sales/invoices/" + id)`,
  `router.push("/pos?add=" + code)`. Read params with `useLocalSearchParams()`.
* Do not add `_layout.tsx` inside module folders; the `(app)` stack handles them.
* Set the title (and actions) from the screen:
  `<Stack.Screen options={{ title: "Invoice", headerLargeTitleEnabled: false, headerRight: () => <HeaderButton … /> }} />`
  List/dashboard screens keep the iOS large title; detail screens turn it off.

## Data

* `api<T>(path, init)` / `post<T>(path, body, method?)` — same envelope and
  idempotent-retry semantics as web. Errors: `ApiError` (`.code`),
  `PendingApprovalError` (HTTP 202 PENDING with `approvalId`). Use
  `errorMessage(err)` for text, `toast.error(err)` to show it.
* Session: `useSession()` → `me`, `can(perm)`, `canAny([...])`, `signOut()`.
  The `["me"]` query key holds `/auth/me` like on web.
* Working branch (web cookie `goldos_branch`): `useBranch()` (reactive,
  `branchId`, `branches`, `setBranchId`) and `getSavedBranchId()` (sync).
  `useAccountsScope()` in `lib/accounts` is the web hook of the same name.
* Lists: `usePagedQuery<T>(key, page => path)` + `<ScreenList query={…}>` for
  `{rows,total}` endpoints with infinite scroll and pull-to-refresh.
* Uploads: `formApi(path, form)` + `appendFile(form, field, { uri, name, type })`
  from expo-image-picker / expo-document-picker.
* CSV export: `downloadCsv(path, filename)` → share sheet.
  Printing: build HTML with `printDoc()` and call `printHtml()` / `sharePdf()`.
* Authenticated images: `<Image source={authedSource(path)} />` (expo-image).

## Formatting (`@/lib/format`)

Money is integer **cents**, weight integer **milligrams** — never floats on the
wire. `lkr`, `lkr0`, `money`, `money0`, `lkrSigned`, `toCents`, `centsInput`;
`grams`, `g`, `toMg`, `mgInput`; `date`, `dateTime`, `shortDate`, `longDate`,
`ago`, `humanize`, `businessToday`.

## Design system (`@/ui`)

Apple HIG first: system grouped backgrounds, inset-grouped lists, SF Symbols,
large titles, sheets for forms, haptics on every commit. Gold is the tint.
All colours come from `useTheme().c` — light and dark are both first-class.

* Layout: `Screen` (scroll + refresh + keyboard), `ScreenList`, `BottomBar`,
  `useRefresh(...queries)`, `Gap`, `Inset`.
* Lists: `Section` (title/footer/action), `Row` (icon tile, subtitle, value,
  href/onPress, chevron, selected), `KeyValue`, `SwitchRow`, `Separator`, `IconTile`.
* Surfaces: `Card`, `CardHeader`, `Hero`, `GoldGlow`, `StatTile`, `Grid`,
  `BarList`, `Callout`, `ModuleHero`, `StatusBoard`, `ModuleCard`, `ModuleGrid`,
  `ModuleLinks`, `LineageChain`.
* Controls: `Button` (filled/tinted/gray/plain/destructive/dark/glass),
  `IconButton`, `HeaderButton`, `Field` (`kind` money/weight/int/email/password…),
  `FieldRow`, `FormStack`, `SearchField`, `SelectField`, `OptionSheet`,
  `Segmented`, `Chips`, `ModuleTabs`, `DateField`, `Checkbox`, `BranchSelect`.
* Feedback: `toast.success/error/info/warning`, `await confirm({...})`,
  `await promptText({...})`, `await chooseAction(title, options)`,
  `await scanBarcode()`, `CameraScanner`, `EmptyState`, `ErrorState`,
  `Loading`, `Skeleton`, `SkeletonRows`, `Pill`, `StatusPill`, `Avatar`, `Can`.
* Charts: `AreaChart`, `BarChart`, `Sparkline`, `Ring`, `Donut`.
* Icons: `<Icon name="…" />` — names are the keys of `ICONS` in `ui/Icon.tsx`
  (SF Symbol on iOS, Material Symbol on Android, both type-checked).

Web → mobile translation: tables become `Section`s of `Row`s (title, subtitle,
right value) that push a detail screen; modals become `Sheet`s; tabs become
`Segmented` (≤4) or `Chips`; `window.confirm`/`prompt` become `confirm`/`promptText`;
sonner toasts become `toast`.
