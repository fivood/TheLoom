extends SceneTree

const Runtime = preload("res://theloom_runtime.gd")

func _initialize() -> void:
	var text := FileAccess.get_file_as_string("res://runtime_v2_fixture.json")
	var pkg = JSON.parse_string(text)
	assert(typeof(pkg) == TYPE_DICTIONARY)
	var run = Runtime.new(pkg, "protocol_test")
	run.start()
	assert(run.protocol_version == 2)
	assert(run.source_protocol_version == 2)
	assert(run.events.size() == 6)
	assert(run.events.map(func(event): return "%s:%s" % [event["nodeId"], event["event"]]) == [
		"set:enter", "set:display", "set:leave",
		"say:enter", "say:display", "say:leave",
	])
	var set_display: Dictionary = run.events[1]
	assert(set_display["assetIds"] == ["voice"])
	assert(set_display["fields"][0]["value"] == "低声")
	assert(set_display["changes"]["variables"][0] == { "name": "n", "before": 0, "after": 1 })
	assert(set_display["changes"]["entities"][0] == {
		"entityTechnicalName": "detective",
		"field": "trust",
		"before": 5,
		"after": 7,
	})
	var say_enter: Dictionary = run.events[3]
	assert(say_enter["edgeId"] == "next")
	assert(say_enter["choiceKey"] == "choice-next")
	assert(say_enter["changes"]["variables"][0] == { "name": "n", "before": 1, "after": 3 })

	# ---------- R19-2 跨流程调用:与 TypeScript 运行库同一夹具、同一断言 ----------
	var fails: Array = []
	var check := func(name: String, got, want) -> void:
		if got != want:
			fails.append("%s: got=%s want=%s" % [name, str(got), str(want)])

	var x = Runtime.new(pkg, "caller")
	x.start()
	check.call("flow=callee", x.flow["id"], "callee")
	check.call("callStack=1", x.call_stack.size(), 1)
	var texts: Array = x.log.map(func(b): return b["text"])
	check.call("不走默认起点", texts.has("默认起点(不该走到)"), false)
	check.call("走命名入口", texts.has("支线开场"), true)
	check.call("文本参数字面量", x.vars.get("who"), "林晚")
	check.call("数值参数表达式", x.vars.get("bonus"), 5)

	x.choose(0)
	check.call("返回值写回", x.vars.get("result"), 15)
	check.call("回到调用方", x.flow["id"], "caller")
	check.call("调用栈清空", x.call_stack.size(), 0)
	check.call("参数还原原值", x.vars.get("who"), "原值")
	check.call("临时参数删除", x.vars.has("bonus"), false)
	var last_beat: Dictionary = x.log[x.log.size() - 1]
	check.call("继续走调用点出边", last_beat["text"], "回来了")

	# ---------- R19-3 外部事件:与 TypeScript 运行库同一夹具、同一断言 ----------
	var e = Runtime.new(pkg, "evflow")
	var seen_calls: Array = []
	e.external_event_requested.connect(func(c): seen_calls.append(c))
	e.start()
	# x1 是 continue:发出即继续,不挂起;x2 是 value:挂起
	check.call("continue 事件已发出", seen_calls.size() >= 1, true)
	var first_call: Dictionary = seen_calls[0] if seen_calls.size() > 0 else {}
	check.call("事件名", first_call.get("name", ""), "play_anim")
	var first_args: Dictionary = first_call.get("args", {})
	check.call("文本参数字面量", first_args.get("clip"), "开门")
	check.call("数值参数表达式", first_args.get("speed"), 2)
	check.call("停在 value 事件上", e.pending_external.is_empty(), false)
	var pend_call: Dictionary = e.pending_external.get("call", {})
	check.call("挂起的事件名", pend_call.get("name", ""), "solve_puzzle")
	check.call("挂起时没有选项", e.choices.size(), 0)
	check.call("挂起时未结束", e.ended, false)
	# 宿主回值 8 → score=8 → 条件为真 → 走「解开了」
	e.resolve_external(8)
	check.call("回值写入变量", e.vars.get("score"), 8)
	check.call("挂起已清除", e.pending_external.is_empty(), true)
	var ev_last: Dictionary = e.log[e.log.size() - 1]
	check.call("走真分支", ev_last["text"], "解开了")
	check.call("重复 resolve 安全", e.resolve_external(1), false)

	if fails.is_empty():
		print("R19-2 / R19-3 Godot:全部断言通过")
		quit(0)
	else:
		for f in fails:
			printerr("FAIL ", f)
		printerr("实际 log: ", texts)
		quit(1)
