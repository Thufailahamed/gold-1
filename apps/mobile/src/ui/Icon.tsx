import { SymbolView, type SymbolWeight } from "expo-symbols";
import type { SFSymbol } from "sf-symbols-typescript";
import type { AndroidSymbol } from "expo-symbols";
import type { ColorValue, StyleProp, ViewStyle } from "react-native";

/**
 * One icon set for the whole app: SF Symbols on iOS, Material Symbols on
 * Android. Pick from `ICONS` by key — add a pair here if a screen needs a
 * new glyph (both names are type-checked against the platform catalogs).
 */
export const ICONS = {
  // navigation & chrome
  home: { ios: "house.fill", android: "home" },
  dashboard: { ios: "square.grid.2x2.fill", android: "dashboard" },
  more: { ios: "ellipsis.circle", android: "more_horiz" },
  menu: { ios: "line.3.horizontal", android: "menu" },
  chevronRight: { ios: "chevron.right", android: "chevron_right" },
  chevronLeft: { ios: "chevron.left", android: "chevron_left" },
  chevronDown: { ios: "chevron.down", android: "expand_more" },
  chevronUp: { ios: "chevron.up", android: "expand_less" },
  close: { ios: "xmark", android: "close" },
  closeCircle: { ios: "xmark.circle.fill", android: "cancel" },
  check: { ios: "checkmark", android: "check" },
  checkCircle: { ios: "checkmark.circle.fill", android: "check_circle" },
  circle: { ios: "circle", android: "radio_button_unchecked" },
  plus: { ios: "plus", android: "add" },
  plusCircle: { ios: "plus.circle.fill", android: "add_circle" },
  minus: { ios: "minus", android: "remove" },
  minusCircle: { ios: "minus.circle.fill", android: "do_not_disturb_on" },
  search: { ios: "magnifyingglass", android: "search" },
  filter: { ios: "line.3.horizontal.decrease.circle", android: "filter_list" },
  sort: { ios: "arrow.up.arrow.down", android: "swap_vert" },
  edit: { ios: "pencil", android: "edit" },
  trash: { ios: "trash", android: "delete" },
  share: { ios: "square.and.arrow.up", android: "share" },
  download: { ios: "arrow.down.circle", android: "download" },
  upload: { ios: "arrow.up.circle", android: "upload" },
  refresh: { ios: "arrow.clockwise", android: "refresh" },
  undo: { ios: "arrow.uturn.backward", android: "undo" },
  arrowRight: { ios: "arrow.right", android: "arrow_forward" },
  arrowLeft: { ios: "arrow.left", android: "arrow_back" },
  arrowUp: { ios: "arrow.up", android: "arrow_upward" },
  arrowDown: { ios: "arrow.down", android: "arrow_downward" },
  arrowUpRight: { ios: "arrow.up.right", android: "north_east" },
  arrowDownLeft: { ios: "arrow.down.left", android: "south_west" },
  swap: { ios: "arrow.left.arrow.right", android: "swap_horiz" },
  link: { ios: "link", android: "link" },
  copy: { ios: "doc.on.doc", android: "content_copy" },
  eye: { ios: "eye", android: "visibility" },
  eyeOff: { ios: "eye.slash", android: "visibility_off" },
  lock: { ios: "lock.fill", android: "lock" },
  unlock: { ios: "lock.open.fill", android: "lock_open" },
  key: { ios: "key.fill", android: "key" },
  bell: { ios: "bell.fill", android: "notifications" },
  info: { ios: "info.circle", android: "info" },
  help: { ios: "questionmark.circle", android: "help" },
  warning: { ios: "exclamationmark.triangle.fill", android: "warning" },
  alert: { ios: "exclamationmark.circle.fill", android: "error" },
  calendar: { ios: "calendar", android: "calendar_month" },
  clock: { ios: "clock", android: "schedule" },
  history: { ios: "clock.arrow.circlepath", android: "history" },
  print: { ios: "printer.fill", android: "print" },
  camera: { ios: "camera.fill", android: "photo_camera" },
  photo: { ios: "photo", android: "image" },
  paperclip: { ios: "paperclip", android: "attach_file" },
  flash: { ios: "bolt.fill", android: "bolt" },
  flashOff: { ios: "bolt.slash.fill", android: "flash_off" },
  signOut: { ios: "rectangle.portrait.and.arrow.right", android: "logout" },
  settings: { ios: "gearshape.fill", android: "settings" },
  sliders: { ios: "slider.horizontal.3", android: "tune" },
  power: { ios: "power", android: "power_settings_new" },
  star: { ios: "star.fill", android: "star" },
  sparkles: { ios: "sparkles", android: "auto_awesome" },
  // business
  scan: { ios: "barcode.viewfinder", android: "barcode_scanner" },
  barcode: { ios: "barcode", android: "barcode" },
  qrcode: { ios: "qrcode", android: "qr_code_2" },
  tag: { ios: "tag.fill", android: "sell" },
  tags: { ios: "tag.circle.fill", android: "loyalty" },
  gem: { ios: "diamond.fill", android: "diamond" },
  coins: { ios: "dollarsign.circle.fill", android: "paid" },
  banknote: { ios: "banknote.fill", android: "payments" },
  creditCard: { ios: "creditcard.fill", android: "credit_card" },
  cart: { ios: "cart.fill", android: "shopping_cart" },
  bag: { ios: "bag.fill", android: "shopping_bag" },
  receipt: { ios: "doc.text.fill", android: "receipt_long" },
  invoice: { ios: "doc.plaintext.fill", android: "description" },
  document: { ios: "doc.fill", android: "draft" },
  folder: { ios: "folder.fill", android: "folder" },
  book: { ios: "book.fill", android: "menu_book" },
  ledger: { ios: "book.closed.fill", android: "book" },
  package: { ios: "shippingbox.fill", android: "package_2" },
  archive: { ios: "archivebox.fill", android: "inventory_2" },
  truck: { ios: "truck.box.fill", android: "local_shipping" },
  scale: { ios: "scalemass.fill", android: "scale" },
  balance: { ios: "building.columns.fill", android: "account_balance" },
  bank: { ios: "building.columns", android: "account_balance" },
  wallet: { ios: "wallet.bifold.fill", android: "account_balance_wallet" },
  flask: { ios: "flask.fill", android: "science" },
  flame: { ios: "flame.fill", android: "local_fire_department" },
  hammer: { ios: "hammer.fill", android: "construction" },
  wrench: { ios: "wrench.and.screwdriver.fill", android: "build" },
  clipboard: { ios: "list.clipboard.fill", android: "assignment" },
  clipboardCheck: { ios: "checklist", android: "fact_check" },
  chart: { ios: "chart.bar.fill", android: "bar_chart" },
  trendUp: { ios: "chart.line.uptrend.xyaxis", android: "trending_up" },
  trendDown: { ios: "chart.line.downtrend.xyaxis", android: "trending_down" },
  pie: { ios: "chart.pie.fill", android: "pie_chart" },
  gauge: { ios: "gauge.with.dots.needle.67percent", android: "speed" },
  percent: { ios: "percent", android: "percent" },
  calculator: { ios: "plus.forwardslash.minus", android: "calculate" },
  building: { ios: "building.2.fill", android: "apartment" },
  store: { ios: "storefront.fill", android: "storefront" },
  person: { ios: "person.fill", android: "person" },
  personCheck: { ios: "person.fill.checkmark", android: "how_to_reg" },
  personAdd: { ios: "person.badge.plus", android: "person_add" },
  people: { ios: "person.2.fill", android: "group" },
  shield: { ios: "checkmark.shield.fill", android: "verified_user" },
  shieldAlert: { ios: "exclamationmark.shield.fill", android: "gpp_maybe" },
  lifebuoy: { ios: "lifepreserver.fill", android: "support" },
  mail: { ios: "envelope.fill", android: "mail" },
  phone: { ios: "phone.fill", android: "call" },
  message: { ios: "bubble.left.and.bubble.right.fill", android: "forum" },
  inbox: { ios: "tray.fill", android: "inbox" },
  inboxIn: { ios: "tray.and.arrow.down.fill", android: "move_to_inbox" },
  inboxOut: { ios: "tray.and.arrow.up.fill", android: "outbox" },
  layers: { ios: "square.stack.3d.up.fill", android: "layers" },
  grid: { ios: "square.grid.3x3.fill", android: "grid_view" },
  list: { ios: "list.bullet", android: "list" },
  pin: { ios: "mappin.and.ellipse", android: "location_on" },
  globe: { ios: "globe", android: "public" },
  sun: { ios: "sun.max.fill", android: "light_mode" },
  moon: { ios: "moon.fill", android: "dark_mode" },
  return: { ios: "arrow.uturn.left.circle.fill", android: "assignment_return" },
  ban: { ios: "nosign", android: "block" },
  pause: { ios: "pause.circle.fill", android: "pause_circle" },
  play: { ios: "play.circle.fill", android: "play_circle" },
  stop: { ios: "stop.circle.fill", android: "stop_circle" },
  hourglass: { ios: "hourglass", android: "hourglass_empty" },
  sigma: { ios: "sum", android: "functions" },
  number: { ios: "number", android: "tag" },
  textformat: { ios: "textformat", android: "text_fields" },
  wand: { ios: "wand.and.stars", android: "auto_fix_high" },
  target: { ios: "scope", android: "my_location" },
  crown: { ios: "crown.fill", android: "workspace_premium" },
  gift: { ios: "gift.fill", android: "redeem" },
} as const satisfies Record<string, { ios: SFSymbol; android: AndroidSymbol }>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 20,
  color,
  weight = "medium",
  style,
}: {
  name: IconName;
  size?: number;
  color?: ColorValue;
  weight?: SymbolWeight;
  style?: StyleProp<ViewStyle>;
}) {
  const n = ICONS[name];
  return (
    <SymbolView
      name={{ ios: n.ios, android: n.android }}
      size={size}
      tintColor={color}
      weight={weight}
      style={style}
      resizeMode="scaleAspectFit"
    />
  );
}
