import { config } from "../../package.json";
import { getString } from "../utils/locale";

export function registerItemMenu(_win: Window) {
  const menuIcon = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;
  ztoolkit.Menu.register("item", {
    tag: "menu",
    id: `${config.addonRef}-itemmenu-root`,
    label: getString("menuitem-root"),
    icon: menuIcon,
    children: [
      {
        tag: "menuitem",
        id: `${config.addonRef}-itemmenu-parse`,
        label: getString("menuitem-parse"),
        commandListener: () => {
          addon.hooks.onParseSelectedItem();
        },
      },
      {
        tag: "menuitem",
        id: `${config.addonRef}-itemmenu-parse-force`,
        label: getString("menuitem-parse-force"),
        commandListener: () => {
          addon.hooks.onParseSelectedItem({ force: true });
        },
      },
    ],
  });
}
