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
	var x = Runtime.new(pkg, "caller")
	x.start()
	# 命名入口生效:走 k1 而不是默认起点 k0
	assert(x.flow["id"] == "callee")
	assert(x.call_stack.size() == 1)
	var texts := x.log.map(func(b): return b["text"])
	assert(not texts.has("默认起点(不该走到)"))
	assert(texts.has("支线开场"))
	# 参数绑定:文本取字面量,数值走表达式
	assert(x.vars["who"] == "林晚")
	assert(x.vars["bonus"] == 5)
	# 继续:k1 → k2(return bonus + 10 = 15)→ 弹栈回 c1 → c2
	x.choose(0)
	assert(x.vars["result"] == 15)
	assert(x.flow["id"] == "caller")
	assert(x.call_stack.is_empty())
	# 参数是局部作用域:返回后还原原值,原本不存在的被删除
	assert(x.vars["who"] == "原值")
	assert(not x.vars.has("bonus"))
	var last_beat: Dictionary = x.log[x.log.size() - 1]
	assert(last_beat["text"] == "回来了")
	print("R19-2 Godot 跨流程调用断言全部通过")
	quit(0)
