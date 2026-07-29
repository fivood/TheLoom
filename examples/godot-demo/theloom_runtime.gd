extends RefCounted
class_name TheLoomRuntime

## TheLoom 引擎包 · Godot 4 运行库
##
## 从 TheLoom「工具 → 引擎包 .zip」导出的 `theloom-package.json` 直接构造
## 一个可演出实例。行进语义与 TS 端 FlowRuntime / 应用内 Player 完全一致:
##   直通节点自动前进、无出边逐层回溯、exit 走父层片段命名引脚、
##   fragment 默认引脚、fallback 遮蔽、一次性选项、条件边过滤、
##   检定 2d6+技能 vs 难度(红检定沿用首次结果)。
##
## 用法:
##   var run := TheLoomRuntime.new(package, "flow_technical_name")
##   run.seed_val = 42            # 可选:固定种子,同种子掷骰序列复现
##   run.beat_added.connect(_on_beat)
##   run.start()
##   run.choose(0)                # 处于选择时按下标选一个

signal beat_added(beat: Dictionary)
signal event_emitted(event: Dictionary)

const RUNTIME_PROTOCOL_VERSION := 2
const _NODE_LABEL := {
	"dialogue": "对白", "fragment": "剧情片段", "hub": "汇聚点",
	"condition": "条件分支", "instruction": "指令",
	"jump": "跳转", "exit": "出口", "check": "检定",
	"call": "调用", "return": "返回",
}
const _ANNOTATION := ["note", "zone"]
## R19-2:call 返回后也自动继续
const _AUTO_ADVANCE := ["hub", "instruction", "condition", "exit", "check", "call"]
## R19-2 调用栈深度上限:超过按无限递归处理
const MAX_CALL_DEPTH := 32

var project: Dictionary
## 入口流程;跨流程调用时 flow 会变,这个始终是最初进入的那个
var root_flow: Dictionary
var flow: Dictionary
## R19-2 调用栈:栈顶是最近一次 call 的返回点
var call_stack: Array = []         # Array[Dictionary]
var protocol_version: int = RUNTIME_PROTOCOL_VERSION
var source_protocol_version: int = 1
var seed_val: int = 0
var vars: Dictionary = {}
var entity_props: Dictionary = {}
var choices: Array = []            # Array[Dictionary]
var log: Array = []                # Array[Dictionary]
var events: Array = []             # Array[Dictionary]
var ended: bool = false

var _rng_state: int = 0
var _rolls: int = 0
var _cur_path: Array = []          # Array[String]:片段 id 栈
var _seen: Dictionary = {}         # id → true
var _taken: Dictionary = {}        # edge id → true
var _checks: Dictionary = {}       # node id → bool
var _tech_to_id: Dictionary = {}   # 节点技术名 → id
var _entity_by_id: Dictionary = {}


func _init(pkg: Dictionary, flow_ref: String) -> void:
	project = pkg
	source_protocol_version = int(pkg.get("runtimeProtocolVersion", 1))
	if source_protocol_version < 1:
		source_protocol_version = 1
	var found: Dictionary = {}
	for f in _flows():
		if f.get("id", "") == flow_ref or f.get("technicalName", "") == flow_ref:
			found = f
			break
	if found.is_empty():
		push_error("流程不存在:%s" % flow_ref)
		flow = { "id": "", "nodes": [], "edges": [] }
	else:
		flow = found
	root_flow = flow
	seed_val = _random_seed()
	for e in _entities():
		_entity_by_id[e.get("id", "")] = e
	_collect_tech_names(flow)


func start(start_node_id: String = "", seed_override: int = -1) -> void:
	if seed_override >= 0:
		seed_val = seed_override
	_seed_rng(seed_val)
	_rolls = 0
	log.clear()
	events.clear()
	choices.clear()
	ended = false
	_cur_path.clear()
	flow = root_flow
	call_stack.clear()
	_seen.clear()
	_taken.clear()
	_checks.clear()
	vars.clear()
	entity_props = _build_entity_props()
	for v in _variables():
		vars[v.get("name", "")] = _coerce_var(v.get("type", "string"), v.get("value", ""))

	if start_node_id != "" and _find_node(flow, start_node_id) != null:
		_visit([], start_node_id, { "choice_key": "start:%s" % start_node_id })
		return
	# R19-2:start_node_id 也可以是命名入口的 key
	if start_node_id != "":
		var by_key := _find_entry(flow, start_node_id)
		if not by_key.is_empty():
			_bind_args(by_key.get("params", []), [])
			_visit([], String(by_key.get("nodeId", "")), { "choice_key": "entry:%s" % start_node_id })
			return
	var starts := _start_nodes(flow)
	if starts.is_empty():
		ended = true
		return
	if starts.size() == 1:
		var start_id: String = starts[0].get("id", "")
		_visit([], start_id, { "choice_key": "start:%s" % start_id })
		return
	choices = starts.map(func(s): return {
		"label": s.get("data", {}).get("title", "") if s.get("data", {}).get("title", "") != "" else _NODE_LABEL.get(s.get("type", ""), s.get("type", "")),
		"choice_key": "start:%s" % s.get("id", ""),
		"node_id": s.get("id", ""),
	})


func choose(index: int) -> void:
	if index < 0 or index >= choices.size() or ended:
		return
	var c: Dictionary = choices[index]
	var node_id := String(c.get("node_id", ""))
	if node_id == "":
		return
	var before_vars := vars.duplicate(true)
	var before_entities := entity_props.duplicate(true)
	if c.get("edge_id", "") != "" and c.get("once", false):
		_taken[c["edge_id"]] = true
	if c.get("effect", "") != "":
		_apply_instructions(c["effect"])
	_visit(
		_cur_path.duplicate(),
		node_id,
		{ "edge_id": c.get("edge_id", ""), "choice_key": c.get("choice_key", "") },
		_state_changes(before_vars, before_entities),
	)


## ---------- R19-2 跨流程调用 ----------

## 按技术名或 id 找流程;找不到返回空字典
func _find_flow(ref: String) -> Dictionary:
	for f in _flows():
		if f.get("id", "") == ref or f.get("technicalName", "") == ref:
			return f
	return {}

## 找命名入口;找不到返回空字典
func _find_entry(f: Dictionary, key: String) -> Dictionary:
	for e in f.get("entries", []):
		if String(e.get("key", "")) == key and _find_node(f, String(e.get("nodeId", ""))) != null:
			return e
	return {}

## 解析目标入口 → { node_id, params };无法进入时返回空字典
func _resolve_entry(f: Dictionary, entry_key: String) -> Dictionary:
	if entry_key != "":
		var e := _find_entry(f, entry_key)
		if e.is_empty():
			return {}
		return { "node_id": String(e.get("nodeId", "")), "params": e.get("params", []) }
	var starts := _start_nodes(f)
	if starts.is_empty():
		return {}
	return { "node_id": String(starts[0].get("id", "")), "params": [] }

## 绑定实参,返回被覆盖变量的原值(call 弹栈时还原;has=false 表示原本不存在)
func _bind_args(params: Array, args: Array) -> Array:
	var saved: Array = []
	if params.is_empty():
		return saved
	var by_name: Dictionary = {}
	for a in args:
		by_name[String(a.get("name", ""))] = String(a.get("expr", ""))
	for pm in params:
		var pname := String(pm.get("name", ""))
		var ptype := String(pm.get("type", "string"))
		saved.append({ "name": pname, "has": vars.has(pname), "value": vars.get(pname, null) })
		var expr := String(by_name.get(pname, ""))
		if expr.strip_edges() != "":
			# 文本参数取字面量;布尔与数值走表达式求值
			if ptype == "boolean":
				var b = _eval_condition(expr)
				vars[pname] = false if b == null else b
			elif ptype == "number":
				vars[pname] = _eval_number(expr)
			else:
				vars[pname] = expr
		else:
			vars[pname] = _coerce_var(ptype, String(pm.get("default", "")))
	return saved

## 还原参数原值
func _restore_params(saved: Array) -> void:
	for sv in saved:
		var nm := String(sv.get("name", ""))
		if sv.get("has", false):
			vars[nm] = sv.get("value")
		else:
			vars.erase(nm)

## 弹出调用帧回到调用点。先还原参数再写返回值 —— 两者同名时返回值胜出。
## 返回 { node, path };栈空或调用点失效时返回空字典
func _pop_frame(return_value) -> Dictionary:
	if call_stack.is_empty():
		return {}
	var frame: Dictionary = call_stack.pop_back()
	_restore_params(frame.get("saved_params", []))
	var f := _find_flow(String(frame.get("flow_id", "")))
	if f.is_empty():
		return {}
	flow = f
	var rv := String(frame.get("return_var", ""))
	if rv != "" and return_value != null:
		vars[rv] = return_value
	var path: Array = frame.get("path", [])
	var node = _find_node(_container(path), String(frame.get("node_id", "")))
	if node == null:
		return {}
	return { "node": node, "path": path.duplicate() }


## ---------- 内部辅助 ----------

func _flows() -> Array:
	return project.get("flows", [])

func _variables() -> Array:
	return project.get("variables", [])

func _entities() -> Array:
	return project.get("entities", [])

func _find_node(sub: Dictionary, node_id: String):
	for n in sub.get("nodes", []):
		if n.get("id", "") == node_id:
			return n
	return null

func _container(path: Array) -> Dictionary:
	var cur: Dictionary = flow
	for id in path:
		var n = _find_node(cur, id)
		if n == null:
			return { "nodes": [], "edges": [] }
		var data: Dictionary = n.get("data", {})
		var sub_dict: Dictionary = data.get("sub", {})
		if sub_dict.is_empty():
			return { "nodes": [], "edges": [] }
		cur = sub_dict
	return cur

func _start_nodes(sub: Dictionary) -> Array:
	var incoming: Dictionary = {}
	for e in sub.get("edges", []):
		incoming[e.get("target", "")] = true
	var story := []
	for n in sub.get("nodes", []):
		if not _ANNOTATION.has(n.get("type", "")):
			story.append(n)
	var starts := story.filter(func(n): return not incoming.has(n.get("id", "")))
	return starts if starts.size() > 0 else story

func _collect_tech_names(sub: Dictionary) -> void:
	for n in sub.get("nodes", []):
		var data: Dictionary = n.get("data", {})
		var tn: String = data.get("technicalName", "")
		if tn != "":
			_tech_to_id[tn] = n.get("id", "")
		var sub_dict: Dictionary = data.get("sub", {})
		if not sub_dict.is_empty():
			_collect_tech_names(sub_dict)

func _push_beat(beat: Dictionary) -> void:
	log.append(beat)
	beat_added.emit(beat)

func _push_event(
	phase: String,
	path: Array,
	node: Dictionary,
	trigger: Dictionary,
	changes: Dictionary,
	note: String = "",
) -> void:
	var data: Dictionary = node.get("data", {})
	var speaker_id: String = data.get("speakerId", "")
	var speaker = _entity_by_id.get(speaker_id, null) if speaker_id != "" else null
	var event := {
		"protocolVersion": RUNTIME_PROTOCOL_VERSION,
		"sourceProtocolVersion": source_protocol_version,
		"event": phase,
		"flowId": flow.get("id", ""),
		"nodeId": node.get("id", ""),
		"path": path.duplicate(),
		"nodeType": node.get("type", ""),
		"kind": node.get("type", ""),
		"title": data.get("title", ""),
		"text": data.get("text", ""),
		"fields": data.get("fields", []).duplicate(true),
		"assetIds": project.get("attachments", {}).get(node.get("id", ""), []).duplicate(),
		"changes": changes.duplicate(true),
	}
	if flow.get("technicalName", "") != "":
		event["flowTechnicalName"] = flow["technicalName"]
	if data.get("technicalName", "") != "":
		event["nodeTechnicalName"] = data["technicalName"]
	if speaker != null:
		event["speakerId"] = speaker.get("id", "")
		event["speakerName"] = speaker.get("name", "")
	if trigger.get("edge_id", "") != "":
		event["edgeId"] = trigger["edge_id"]
	if trigger.get("choice_key", "") != "":
		event["choiceKey"] = trigger["choice_key"]
	if note != "":
		event["note"] = note
	events.append(event)
	event_emitted.emit(event)

## 无出边逐层回溯 + exit 命名引脚 + 条件/检定分支过滤;返回可选项列表与新的路径
func _outgoing_choices(path: Array, node: Dictionary) -> Dictionary:
	var cur_p: Array = path.duplicate()
	var cur = node
	var exit_id: String = ""
	for guard in range(64):
		if cur != null and cur.get("type", "") == "exit" and cur_p.size() > 0:
			exit_id = cur.get("id", "")
			var frag_id: String = cur_p[cur_p.size() - 1]
			cur_p = cur_p.slice(0, cur_p.size() - 1)
			cur = _find_node(_container(cur_p), frag_id)
		var c := _container(cur_p)
		var edges := []
		if cur != null:
			for e in c.get("edges", []):
				if e.get("source", "") == cur.get("id", ""):
					edges.append(e)
		if exit_id != "":
			var named := edges.filter(func(e): return e.get("sourceHandle", "") == "exit:%s" % exit_id)
			edges = named if named.size() > 0 else edges.filter(func(e): return String(e.get("sourceHandle", "")) == "")
			exit_id = ""
		elif cur != null and cur.get("type", "") == "fragment":
			edges = edges.filter(func(e): return String(e.get("sourceHandle", "")) == "")
		if cur != null and cur.get("type", "") == "condition":
			var result = _eval_condition(cur.get("data", {}).get("text", ""))
			if result != null:
				var want = "true" if result else "false"
				var picked := edges.filter(func(e): return e.get("sourceHandle", "") == want)
				edges = picked if picked.size() > 0 else []
		if cur != null and cur.get("type", "") == "check":
			var passed: bool = _checks.get(cur.get("id", ""), false)
			var want_c = "success" if passed else "fail"
			var picked_c := edges.filter(func(e): return e.get("sourceHandle", "") == want_c)
			edges = picked_c if picked_c.size() > 0 else []
		var usable := edges.filter(func(e):
			if e.get("once", false) and _taken.has(e.get("id", "")):
				return false
			if e.get("condition", "") != "":
				var cond = _eval_condition(e["condition"])
				if cond == false:
					return false
			return true
		)
		var non_fb := usable.filter(func(e): return not e.get("fallback", false))
		var final_usable = non_fb if non_fb.size() > 0 else usable
		if final_usable.size() > 0:
			var out := []
			for e in final_usable:
				var target = _find_node(c, e.get("target", ""))
				var label: String = e.get("label", "")
				if label == "":
					label = (target.get("data", {}).get("title", "") if target != null else "")
				if label == "":
					label = _NODE_LABEL.get(target.get("type", "") if target != null else "", "继续")
				out.append({
					"label": label,
					"node_id": e.get("target", ""),
					"edge_id": e.get("id", ""),
					"choice_key": e.get("choiceId", "") if e.get("choiceId", "") != "" else "edge:%s" % e.get("id", ""),
					"effect": e.get("effect", ""),
					"once": e.get("once", false),
				})
			return { "path": cur_p, "choices": out }
		if cur_p.size() == 0:
			return { "path": cur_p, "choices": [] }
		var frag_id2: String = cur_p[cur_p.size() - 1]
		cur_p = cur_p.slice(0, cur_p.size() - 1)
		cur = _find_node(_container(cur_p), frag_id2)
	return { "path": cur_p, "choices": [] }

## 进入并展示一个节点,自动处理直通型节点(hub/instruction/condition/exit/check)
func _visit(
	path: Array,
	node_id: String,
	initial_trigger: Dictionary = {},
	initial_changes: Dictionary = {},
) -> void:
	var cur_p: Array = path.duplicate()
	var id: String = node_id
	var trigger := initial_trigger.duplicate(true)
	var enter_changes := initial_changes.duplicate(true) if not initial_changes.is_empty() else _empty_changes()
	for guard in range(100):
		if id == "":
			break
		var c := _container(cur_p)
		var node = _find_node(c, id)
		if node == null:
			break
		_push_event("enter", cur_p, node, trigger, enter_changes)
		_seen[id] = true
		var data: Dictionary = node.get("data", {})
		var speaker_id: String = data.get("speakerId", "")
		var speaker = _entity_by_id.get(speaker_id, null) if speaker_id != "" else null
		var before_vars := vars.duplicate(true)
		var before_entities := entity_props.duplicate(true)
		var display_note := ""
		var nested_starts = null
		var nested_path = null
		# R19-2:本节点是否要切流程 / 弹栈返回
		var cross_target = null
		var do_return := false
		var return_value = null

		match node.get("type", ""):
			"dialogue":
				_push_beat({
					"kind": "dialogue", "title": data.get("title", ""), "text": data.get("text", ""),
					"speaker_id": speaker.get("id", "") if speaker != null else "",
					"speaker_name": speaker.get("name", "") if speaker != null else "",
				})
			"fragment":
				_push_beat({ "kind": "fragment", "title": data.get("title", "剧情片段"), "text": data.get("text", "") })
				var sub_dict: Dictionary = data.get("sub", {})
				if not sub_dict.is_empty() and sub_dict.get("nodes", []).size() > 0:
					nested_path = cur_p.duplicate()
					nested_path.append(node.get("id", ""))
					nested_starts = _start_nodes(sub_dict)
			"hub":
				if data.get("title", "") != "":
					_push_beat({ "kind": "hub", "title": data["title"], "text": "" })
			"instruction":
				var warnings := _apply_instructions(data.get("text", ""))
				display_note = ";".join(warnings) if warnings.size() > 0 else ""
				_push_beat({
					"kind": "instruction", "title": data.get("title", "指令"), "text": data.get("text", ""),
					"note": display_note,
				})
			"condition":
				var result = _eval_condition(data.get("text", ""))
				display_note = "无法求值,请手动选择分支" if result == null else ("→ 真" if result else "→ 假")
				_push_beat({ "kind": "condition", "title": data.get("title", "条件分支"), "text": data.get("text", ""), "note": display_note })
			"jump", "call":
				var is_call: bool = node.get("type", "") == "call"
				var target_ref := String(data.get("targetFlow", "")).strip_edges()
				if target_ref == "":
					# 无目标 = R19-2 之前的装饰性跳转:只留一条 beat,继续走出边
					_push_beat({ "kind": node.get("type", ""), "title": data.get("title", "跳转"), "text": data.get("text", "") })
				else:
					var target := _find_flow(target_ref)
					var entry_key := String(data.get("targetEntry", "")).strip_edges()
					var entry: Dictionary = {} if target.is_empty() else _resolve_entry(target, entry_key)
					var fallback_title := "调用" if is_call else "跳转"
					if target.is_empty() or entry.is_empty():
						var why := ""
						if target.is_empty():
							why = "目标流程不存在:%s" % target_ref
						else:
							why = "目标入口不存在:%s" % (entry_key if entry_key != "" else "默认起点")
						display_note = why
						_push_beat({
							"kind": node.get("type", ""), "title": data.get("title", fallback_title),
							"text": data.get("text", ""), "note": why,
						})
					elif is_call and call_stack.size() >= MAX_CALL_DEPTH:
						var deep := "调用深度超过 %d 层,已停止(可能是无限递归)" % MAX_CALL_DEPTH
						display_note = deep
						_push_beat({
							"kind": "call", "title": data.get("title", "调用"),
							"text": data.get("text", ""), "note": deep,
						})
					else:
						var saved := _bind_args(entry.get("params", []), data.get("args", []))
						if is_call:
							call_stack.append({
								"flow_id": flow.get("id", ""),
								"path": cur_p.duplicate(),
								"node_id": node.get("id", ""),
								"return_var": String(data.get("returnVar", "")),
								"saved_params": saved,
							})
						var label := String(target.get("name", ""))
						if label == "":
							label = target_ref
						var note := "%s → %s" % ["调用" if is_call else "跳转", label]
						if entry_key != "":
							note += " · %s" % entry_key
						display_note = note
						_push_beat({
							"kind": node.get("type", ""), "title": data.get("title", fallback_title),
							"text": data.get("text", ""), "note": note,
						})
						cross_target = { "flow": target, "node_id": String(entry["node_id"]), "entry_key": entry_key }
			"return":
				var ret_expr := String(data.get("returnExpr", "")).strip_edges()
				if ret_expr != "":
					return_value = _eval_number(ret_expr)
				var rnote := ""
				if call_stack.is_empty():
					rnote = "调用栈为空,演出结束"
				elif ret_expr != "":
					rnote = "返回值 %s" % str(return_value)
				else:
					rnote = "返回调用点"
				display_note = rnote
				_push_beat({
					"kind": "return", "title": data.get("title", "返回"),
					"text": data.get("text", ""), "note": rnote,
				})
				do_return = true
			"exit":
				_push_beat({ "kind": "exit", "title": "⇥ 经「%s」离开子流程" % data.get("title", "出口"), "text": "" })
			"check":
				var red: bool = data.get("checkRed", false) == true
				var dc: int = int(data.get("checkDc", 10))
				if red and _checks.has(node.get("id", "")):
					display_note = "红色检定只有一次机会 → 沿用先前结果:%s" % ("成功" if _checks[node.get("id", "")] else "失败")
				else:
					var skill: int = _eval_number(data.get("checkExpr", ""))
					var d1: int = _roll_d6()
					var d2: int = _roll_d6()
					_rolls += 2
					var passed: bool = d1 + d2 + skill >= dc
					_checks[node.get("id", "")] = passed
					display_note = "2d6 = %d+%d,技能 %d,合计 %d vs 难度 %d → %s" % [d1, d2, skill, d1 + d2 + skill, dc, "成功" if passed else "失败"]
				_push_beat({
					"kind": "check",
					"title": "%s检定 · %s" % ["红色" if red else "白色", (data.get("title", "") if data.get("title", "") != "" else data.get("checkExpr", ""))],
					"text": data.get("text", ""), "note": display_note,
				})

		_push_event("display", cur_p, node, trigger, _state_changes(before_vars, before_entities), display_note)
		_push_event("leave", cur_p, node, trigger, _empty_changes(), display_note)

		# R19-2:切到目标流程入口(jump 不返回 / call 已压栈)
		if cross_target != null:
			flow = cross_target["flow"]
			cur_p = []
			id = String(cross_target["node_id"])
			var ek := String(cross_target["entry_key"])
			trigger = { "choice_key": "entry:%s" % (ek if ek != "" else id) }
			enter_changes = _empty_changes()
			continue

		# R19-2:显式返回 —— 弹栈后从调用点的出边继续
		if do_return:
			var resumed := _pop_frame(return_value)
			if resumed.is_empty():
				_cur_path = cur_p
				choices = []
				ended = true
				return
			var nxt := _advance_from(resumed["path"], resumed["node"], true)
			if nxt.is_empty():
				return
			id = String(nxt["id"])
			trigger = nxt["trigger"]
			enter_changes = nxt["changes"]
			cur_p = nxt["path"]
			continue

		if nested_starts != null and nested_path != null:
			cur_p = nested_path
			if nested_starts.size() == 1:
				id = nested_starts[0].get("id", "")
				trigger = { "choice_key": "start:%s" % id }
				enter_changes = _empty_changes()
				continue
			_cur_path = cur_p
			choices = nested_starts.map(func(s): return {
				"label": s.get("data", {}).get("title", "") if s.get("data", {}).get("title", "") != "" else _NODE_LABEL.get(s.get("type", ""), s.get("type", "")),
				"choice_key": "start:%s" % s.get("id", ""),
				"node_id": s.get("id", ""),
			})
			return

		var nxt2 := _advance_from(cur_p, node, _AUTO_ADVANCE.has(node.get("type", "")))
		if nxt2.is_empty():
			return
		id = String(nxt2["id"])
		trigger = nxt2["trigger"]
		enter_changes = nxt2["changes"]
		cur_p = nxt2["path"]
	choices = []
	ended = true


## 从 node 的出边继续行进。
## 无出边时:R19-2 调用栈非空 → 隐式返回并从调用点继续;栈空 → 演出结束。
## 返回空字典表示本次行进到此为止(方法内已设置 choices / ended)。
func _advance_from(path: Array, node: Dictionary, auto_advance: bool) -> Dictionary:
	var cur_node := node
	var cur_p: Array = path.duplicate()
	var auto := auto_advance
	for guard in range(MAX_CALL_DEPTH + 1):
		var res := _outgoing_choices(cur_p, cur_node)
		cur_p = res["path"]
		var cs: Array = res["choices"]
		if cs.size() == 0:
			var resumed := _pop_frame(null)
			if resumed.is_empty():
				_cur_path = cur_p
				choices = []
				ended = true
				return {}
			cur_node = resumed["node"]
			cur_p = resumed["path"]
			auto = true
			continue
		if cs.size() == 1 and auto:
			var c0: Dictionary = cs[0]
			var before_edge_vars := vars.duplicate(true)
			var before_edge_entities := entity_props.duplicate(true)
			if c0.get("edge_id", "") != "" and c0.get("once", false):
				_taken[c0["edge_id"]] = true
			if c0.get("effect", "") != "":
				_apply_instructions(c0["effect"])
			return {
				"id": c0["node_id"],
				"trigger": { "edge_id": c0.get("edge_id", ""), "choice_key": c0.get("choice_key", "") },
				"changes": _state_changes(before_edge_vars, before_edge_entities),
				"path": cur_p,
			}
		_cur_path = cur_p
		choices = cs
		return {}
	_cur_path = cur_p
	choices = []
	ended = true
	return {}


## ---------- 变量与实体属性 ----------

func _empty_changes() -> Dictionary:
	return { "variables": [], "entities": [] }

func _state_changes(before_vars: Dictionary, before_entities: Dictionary) -> Dictionary:
	var changed_vars: Array = []
	var changed_entities: Array = []
	var var_names: Dictionary = {}
	for name in before_vars:
		var_names[name] = true
	for name in vars:
		var_names[name] = true
	for name in var_names:
		var before = before_vars.get(name, null)
		var after = vars.get(name, null)
		if before != after:
			changed_vars.append({ "name": name, "before": before, "after": after })
	var entity_names: Dictionary = {}
	for entity_name in before_entities:
		entity_names[entity_name] = true
	for entity_name in entity_props:
		entity_names[entity_name] = true
	for entity_name in entity_names:
		var before_fields: Dictionary = before_entities.get(entity_name, {})
		var after_fields: Dictionary = entity_props.get(entity_name, {})
		var field_names: Dictionary = {}
		for field in before_fields:
			field_names[field] = true
		for field in after_fields:
			field_names[field] = true
		for field in field_names:
			var before = before_fields.get(field, null)
			var after = after_fields.get(field, null)
			if before != after:
				changed_entities.append({
					"entityTechnicalName": entity_name,
					"field": field,
					"before": before,
					"after": after,
				})
	return { "variables": changed_vars, "entities": changed_entities }

func _coerce_var(t: String, raw: String):
	match t:
		"boolean": return raw == "true" or raw == "1"
		"number":
			var v := float(raw)
			return v if fposmod(v, 1.0) != 0.0 else int(v)
		_: return raw

func _build_entity_props() -> Dictionary:
	var out: Dictionary = {}
	for e in _entities():
		var tn: String = e.get("technicalName", "")
		if tn == "":
			continue
		var props: Dictionary = {}
		for f in e.get("fields", []):
			var label: String = f.get("label", "")
			var val: String = f.get("value", "")
			# 数值化优先(与 TS buildEntityProps 语义一致)
			if val.is_valid_float():
				var num := float(val)
				props[label] = num if fposmod(num, 1.0) != 0.0 else int(num)
			elif val == "true" or val == "false":
				props[label] = val == "true"
			else:
				props[label] = val
		out[tn] = props
	return out


## ---------- mulberry32 种子 RNG(与 TS 端 rng.ts 完全一致) ----------

func _seed_rng(s: int) -> void:
	_rng_state = s & 0xFFFFFFFF

func _rand() -> float:
	_rng_state = (_rng_state + 0x6d2b79f5) & 0xFFFFFFFF
	var a: int = _rng_state
	var t: int = ((a ^ (a >> 15)) * (a | 1)) & 0xFFFFFFFF
	t = ((t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) ^ t) & 0xFFFFFFFF
	return float((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

func _roll_d6() -> int:
	return 1 + int(_rand() * 6.0)

func _random_seed() -> int:
	# 1000-999999,方便人类记忆
	return 1000 + (randi() % 999000)


## ---------- 极简条件 / 指令求值器 ----------
##
## 覆盖 TheLoom 项目中常用的脚本子集,一次性满足大多数生成项目的运行需求:
##   条件:变量 与 常量比较、逻辑与或、括号
##     支持:== != > < >= <=、&&、||、!、字面量 true/false/数字/字符串、变量名、
##           实体.字段(TheLoom 特有的 tech_name.field 寻址)
##   指令:分号分隔的赋值语句,支持 =、+=、-=、*=、/=
##
## 不支持:seen()/unseen()、三元运算符、复杂表达式嵌套(相较应用内 R6 AST 更严格)。
## 求值失败(无法求值)返回 null,由调用方决定回退策略(保留全部分支)。

func _eval_condition(src: String):
	var s := src.strip_edges()
	if s == "":
		return null
	var tokens := _tokenize(s)
	var parser := _Parser.new(tokens, self)
	var r = parser.parse_expr()
	if parser.has_error or not parser.at_end():
		return null
	if typeof(r) == TYPE_BOOL:
		return r
	if r == null:
		return null
	# 非布尔结果按 JS 真值转换
	return _truthy(r)

func _eval_number(src) -> int:
	if src == null:
		return 0
	var s := String(src).strip_edges()
	if s == "":
		return 0
	if s.is_valid_int():
		return int(s)
	if s.is_valid_float():
		return int(float(s))
	var tokens := _tokenize(s)
	var parser := _Parser.new(tokens, self)
	var r = parser.parse_expr()
	if parser.has_error or r == null:
		return 0
	if typeof(r) == TYPE_INT:
		return r
	if typeof(r) == TYPE_FLOAT:
		return int(r)
	return 0

func _apply_instructions(src: String) -> Array:
	var warnings: Array = []
	var s := src.strip_edges()
	if s == "":
		return warnings
	for stmt in s.split(";", false):
		var line := stmt.strip_edges()
		if line == "":
			continue
		var handled := false
		for op in ["+=", "-=", "*=", "/=", "="]:
			var idx := line.find(op)
			if idx > 0:
				var lhs := line.substr(0, idx).strip_edges()
				var rhs := line.substr(idx + op.length()).strip_edges()
				var rhs_val = _eval_rhs(rhs)
				if rhs_val == null:
					warnings.append("无法求值:%s" % line)
				else:
					_assign(lhs, op, rhs_val, warnings)
				handled = true
				break
		if not handled:
			warnings.append("无法识别指令:%s" % line)
	return warnings

func _eval_rhs(src: String):
	var tokens := _tokenize(src)
	var parser := _Parser.new(tokens, self)
	var r = parser.parse_expr()
	if parser.has_error:
		return null
	return r

func _assign(lhs: String, op: String, rhs_val, warnings: Array) -> void:
	# 支持 var = ... 与 entity.field = ...
	var dot := lhs.find(".")
	if dot > 0:
		var tn := lhs.substr(0, dot).strip_edges()
		var field := lhs.substr(dot + 1).strip_edges()
		var props: Dictionary = entity_props.get(tn, {})
		var cur = props.get(field, 0)
		props[field] = _combine(cur, op, rhs_val)
		entity_props[tn] = props
		return
	if not vars.has(lhs):
		warnings.append("未声明变量:%s" % lhs)
		vars[lhs] = 0
	vars[lhs] = _combine(vars[lhs], op, rhs_val)

func _combine(cur, op: String, val):
	match op:
		"=": return val
		"+=":
			if typeof(cur) == TYPE_STRING or typeof(val) == TYPE_STRING:
				return str(cur) + str(val)
			return _to_num(cur) + _to_num(val)
		"-=": return _to_num(cur) - _to_num(val)
		"*=": return _to_num(cur) * _to_num(val)
		"/=":
			var d := _to_num(val)
			return 0 if d == 0 else _to_num(cur) / d
	return val

func _to_num(v) -> float:
	match typeof(v):
		TYPE_INT, TYPE_FLOAT: return float(v)
		TYPE_BOOL: return 1.0 if v else 0.0
		TYPE_STRING: return float(v) if String(v).is_valid_float() else 0.0
		_: return 0.0

func _truthy(v) -> bool:
	match typeof(v):
		TYPE_NIL: return false
		TYPE_BOOL: return v
		TYPE_INT, TYPE_FLOAT: return v != 0
		TYPE_STRING: return v != ""
		_: return true


## ---------- 词法 ----------

func _tokenize(src: String) -> Array:
	var out: Array = []
	var i := 0
	var n := src.length()
	while i < n:
		var ch := src[i]
		if ch == " " or ch == "\t" or ch == "\n":
			i += 1
			continue
		# 字符串字面量
		if ch == '"' or ch == "'":
			var quote := ch
			var j := i + 1
			var buf := ""
			while j < n and src[j] != quote:
				if src[j] == "\\" and j + 1 < n:
					buf += src[j + 1]
					j += 2
				else:
					buf += src[j]
					j += 1
			out.append({ "kind": "str", "value": buf })
			i = j + 1
			continue
		# 数字
		if ch >= "0" and ch <= "9":
			var j2 := i
			while j2 < n and ((src[j2] >= "0" and src[j2] <= "9") or src[j2] == "."):
				j2 += 1
			out.append({ "kind": "num", "value": float(src.substr(i, j2 - i)) })
			i = j2
			continue
		# 标识符(允许字母、数字、下划线、点、CJK)
		if _is_ident_start(ch):
			var j3 := i
			while j3 < n and (_is_ident_start(src[j3]) or (src[j3] >= "0" and src[j3] <= "9") or src[j3] == "."):
				j3 += 1
			var word := src.substr(i, j3 - i)
			if word == "true":
				out.append({ "kind": "bool", "value": true })
			elif word == "false":
				out.append({ "kind": "bool", "value": false })
			elif word == "null":
				out.append({ "kind": "null" })
			else:
				out.append({ "kind": "ident", "value": word })
			i = j3
			continue
		# 双字符运算符
		if i + 1 < n:
			var two := src.substr(i, 2)
			if two == "==" or two == "!=" or two == ">=" or two == "<=" or two == "&&" or two == "||":
				out.append({ "kind": "op", "value": two })
				i += 2
				continue
		# 单字符
		if "><+-*/!(),".find(ch) >= 0:
			out.append({ "kind": "op", "value": ch })
			i += 1
			continue
		# 未知字符跳过
		i += 1
	return out

func _is_ident_start(ch: String) -> bool:
	if ch == "_":
		return true
	if ch >= "a" and ch <= "z":
		return true
	if ch >= "A" and ch <= "Z":
		return true
	# CJK 与其他 Unicode 字母:GDScript 无 unicode 属性 API,简单按 Unicode 码点粗判
	var code := ch.unicode_at(0)
	return code >= 128


## ---------- 递归下降 parser ----------
##
## 优先级(从低到高):|| → && → 比较 → 加减 → 乘除 → 一元 → 主项

class _Parser:
	# 出错时用 has_error 传递,不用哨兵值 —— 避免与 float/int 比较时被
	# GDScript 4.6 判为 "Invalid operands 'float' and 'String' in operator '=='"
	var tokens: Array
	var pos: int = 0
	var rt
	var has_error: bool = false

	func _init(t: Array, runtime) -> void:
		tokens = t
		rt = runtime

	func at_end() -> bool: return pos >= tokens.size()

	func _peek(): return tokens[pos] if pos < tokens.size() else null

	func _consume(kind: String, value = null) -> bool:
		var t = _peek()
		if t == null: return false
		if t.get("kind", "") != kind: return false
		if value != null and t.get("value", null) != value: return false
		pos += 1
		return true

	func _fail():
		has_error = true
		return null

	func parse_expr(): return _or()

	func _or():
		var left = _and()
		while _consume("op", "||"):
			var right = _and()
			if has_error: return null
			left = rt._truthy(left) or rt._truthy(right)
		return left

	func _and():
		var left = _cmp()
		while _consume("op", "&&"):
			var right = _cmp()
			if has_error: return null
			left = rt._truthy(left) and rt._truthy(right)
		return left

	func _cmp():
		var left = _add()
		var t = _peek()
		if t != null and t.get("kind", "") == "op" and t.get("value", "") in ["==", "!=", ">", "<", ">=", "<="]:
			pos += 1
			var right = _add()
			if has_error: return null
			match t["value"]:
				"==": return _loose_eq(left, right)
				"!=": return not _loose_eq(left, right)
				">":  return rt._to_num(left) > rt._to_num(right)
				"<":  return rt._to_num(left) < rt._to_num(right)
				">=": return rt._to_num(left) >= rt._to_num(right)
				"<=": return rt._to_num(left) <= rt._to_num(right)
		return left

	func _loose_eq(a, b) -> bool:
		var ta := typeof(a)
		var tb := typeof(b)
		# 数字互比:先都转 float
		if (ta == TYPE_INT or ta == TYPE_FLOAT) and (tb == TYPE_INT or tb == TYPE_FLOAT):
			return rt._to_num(a) == rt._to_num(b)
		# 数字与字符串宽松比较(仿 JS ==)
		if (ta == TYPE_INT or ta == TYPE_FLOAT) and tb == TYPE_STRING:
			return rt._to_num(a) == rt._to_num(b)
		if (tb == TYPE_INT or tb == TYPE_FLOAT) and ta == TYPE_STRING:
			return rt._to_num(a) == rt._to_num(b)
		# 同类型直接比(bool/string/null)
		if ta == tb: return a == b
		return false

	func _add():
		var left = _mul()
		while true:
			var t = _peek()
			if t == null or t.get("kind", "") != "op": break
			var op = t.get("value", "")
			if op != "+" and op != "-": break
			pos += 1
			var right = _mul()
			if has_error: return null
			if op == "+" and (typeof(left) == TYPE_STRING or typeof(right) == TYPE_STRING):
				left = str(left) + str(right)
			elif op == "+":
				left = rt._to_num(left) + rt._to_num(right)
			else:
				left = rt._to_num(left) - rt._to_num(right)
		return left

	func _mul():
		var left = _unary()
		while true:
			var t = _peek()
			if t == null or t.get("kind", "") != "op": break
			var op = t.get("value", "")
			if op != "*" and op != "/": break
			pos += 1
			var right = _unary()
			if has_error: return null
			if op == "*":
				left = rt._to_num(left) * rt._to_num(right)
			else:
				var d = rt._to_num(right)
				left = 0 if d == 0 else rt._to_num(left) / d
		return left

	func _unary():
		if _consume("op", "!"):
			var v = _unary()
			if has_error: return null
			return not rt._truthy(v)
		if _consume("op", "-"):
			var v2 = _unary()
			if has_error: return null
			return -rt._to_num(v2)
		return _primary()

	func _primary():
		var t = _peek()
		if t == null: return _fail()
		if t.get("kind", "") == "num" or t.get("kind", "") == "str" or t.get("kind", "") == "bool":
			pos += 1
			return t["value"]
		if t.get("kind", "") == "null":
			pos += 1
			return null
		if _consume("op", "("):
			var v = parse_expr()
			if not _consume("op", ")"): return _fail()
			return v
		if t.get("kind", "") == "ident":
			pos += 1
			var name = String(t["value"])
			# entity.field 寻址
			if name.find(".") >= 0:
				var parts := name.split(".", false, 1)
				var tn := parts[0]
				var field := parts[1]
				var props: Dictionary = rt.entity_props.get(tn, {})
				if props.has(field): return props[field]
				return null
			# 变量
			if rt.vars.has(name): return rt.vars[name]
			# 无匹配 → null(让调用侧走 fallback)
			return null
		return _fail()
