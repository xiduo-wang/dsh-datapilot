window.__ModuleLoader__.load({
	id: "dsh-datapilot",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region dsh-datapilot client
		/**
		 * DataPilot — client（浏览器）半面。
		 *
		 * 通过 slots 机制注册：
		 *   1. sidebar.panellist 图标（id = PANEL_ID，与 main 的 key 同名）。
		 *   2. main 面板 body（key = PANEL_ID）——一个 iframe，指向 host 半面
		 *      服务的 DataPilot 面板 HTML（/api/dsh-datapilot/panel）。
		 *
		 * 用 iframe 而非内联组件的原因：原型是自包含的单文件（自带 CSS/JS/模拟数据），
		 * iframe 提供样式与脚本隔离，避免污染 DSH shell，也避免被 shell 样式破坏。
		 *
		 * 挂载失败只告警不抛出：web shell 会因插件 apply 抛错而整体启动失败。
		 */
		const PANEL_ID = "datapilot";

		/** client fiber 需要的服务（只需要 slots 插槽）。 */
		const inject = ["slots"];

		/** 侧边栏图标：柱状图（bar-chart），与参考插件同款 stroke 约定。 */
		function Icon(props) {
			const size = props && typeof props.size === "number" ? props.size : 16;
			const active = props && props.active === true;
			return react.createElement("svg", {
				viewBox: "0 0 16 16",
				width: size,
				height: size,
				fill: "none",
				stroke: "currentColor",
				strokeWidth: active ? 1.6 : 1.4,
				opacity: active ? 1 : 0.75,
				"aria-hidden": "true"
			},
				react.createElement("path", { d: "M2.5 13.5V2.5" }),
				react.createElement("path", { d: "M2.5 13.5h11" }),
				react.createElement("rect", { x: 4.5, y: 8.5, width: 2, height: 5, rx: 0.5 }),
				react.createElement("rect", { x: 8, y: 5.5, width: 2, height: 8, rx: 0.5 }),
				react.createElement("rect", { x: 11.5, y: 3.5, width: 2, height: 10, rx: 0.5 })
			);
		}

		/** 面板 body：iframe 加载 host 服务的 DataPilot HTML。 */
		function Panel() {
			return react.createElement("iframe", {
				src: "/api/dsh-datapilot/panel",
				title: "DataPilot",
				style: {
					width: "100%",
					height: "100%",
					border: "none",
					display: "block",
					background: "transparent"
				}
			});
		}

		/** 侧边栏 label：按 document 语言选词典（面板 HTML 自身也按此选语言）。 */
		function label() {
			const lang = typeof document !== "undefined" && document.documentElement
				? document.documentElement.lang
				: "";
			return lang && lang.toLowerCase().startsWith("en") ? "DataPilot" : "DataPilot 数据工作台";
		}

		/**
		 * 挂载侧边栏图标 + 中心列面板。
		 * @param ctx - client 根上下文（slots）。
		 */
		function apply(ctx) {
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register(
				{ name: "sidebar.panellist", id: PANEL_ID, order: 90, label },
				Icon
			));
			ctx.slots.inject("main", () => ctx.slots.register(
				{ name: "main", key: PANEL_ID },
				() => Panel()
			));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
