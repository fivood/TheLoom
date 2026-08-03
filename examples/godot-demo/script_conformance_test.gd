extends SceneTree

## 脚本语义对拍(R20-4):跑 script_fixture.json,与 TS 侧
## src/engine/scriptConformance.test.ts 的同一份夹具逐条比对。
##
##   godot --headless --path examples/godot-demo --script script_conformance_test.gd
##
## 任一条不一致即以非零退出码结束,可接进 CI。

# 运行库声明了 class_name TheLoomRuntime,直接用全局类名构造

var failures: Array = []
var checked := 0


## SceneTree 的入口是 _initialize;写成 _init 会在构造期跑,
## 那时 preload 的常量还没就绪,.new() 会失败
func _initialize() -> void:
	var fixture := _load_fixture()
	if fixture.is_empty():
		printerr("✗ 读不到 script_fixture.json")
		quit(1)
		return

	_run_conditions(fixture)
	_run_numbers(fixture)
	_run_instructions(fixture)

	print("")
	# 一条都没跑到说明夹具没读进来或运行库构造失败 —— 绝不能报「通过」
	if checked == 0:
		printerr("✗ 没有跑到任何用例(夹具为空或运行库构造失败)")
		quit(1)
		return
	if failures.is_empty():
		print("✓ 脚本语义对拍通过:%d 条用例与 TypeScript 一致" % checked)
		quit(0)
	else:
		printerr("✗ %d/%d 条与 TypeScript 不一致:" % [failures.size(), checked])
		for f in failures:
			printerr("    %s" % f)
		quit(1)


func _load_fixture() -> Dictionary:
	var file := FileAccess.open("res://script_fixture.json", FileAccess.READ)
	if file == null:
		return {}
	var parsed = JSON.parse_string(file.get_as_text())
	return parsed if typeof(parsed) == TYPE_DICTIONARY else {}


## 造一个只用来求值的运行库实例:装上夹具的变量、实体属性与已访问节点
func _make_runtime(fixture: Dictionary):
	# 只借它的求值器,不演出;给一个最小流程避免构造时报「流程不存在」
	var rt = TheLoomRuntime.new({
		"flows": [{ "id": "f", "technicalName": "f", "nodes": [], "edges": [] }],
	}, "f")
	rt.vars = _plain(fixture.get("vars", {}))
	rt.entity_props = _plain(fixture.get("entityProps", {}))
	# seen("x") 走 技术名 → 节点 id → 已访问集合,这里两级都按夹具铺好
	for tech in fixture.get("seenTech", []):
		var id := "node_%s" % tech
		rt._tech_to_id[String(tech)] = id
		rt._seen[id] = true
	return rt


## JSON 解析出来的数值都是 float;夹具里的整数要归一成 int,
## 否则 5.0 与 5 在 Dictionary 深比较里不同
func _plain(value):
	match typeof(value):
		TYPE_DICTIONARY:
			var out := {}
			for k in value:
				out[k] = _plain(value[k])
			return out
		TYPE_ARRAY:
			var arr := []
			for v in value:
				arr.append(_plain(v))
			return arr
		TYPE_FLOAT:
			var f: float = value
			return int(f) if fposmod(f, 1.0) == 0.0 else f
		_:
			return value


func _same(a, b) -> bool:
	var an := typeof(a) == TYPE_INT or typeof(a) == TYPE_FLOAT
	var bn := typeof(b) == TYPE_INT or typeof(b) == TYPE_FLOAT
	if an and bn:
		return abs(float(a) - float(b)) < 0.000001
	return a == b


func _run_conditions(fixture: Dictionary) -> void:
	for case in fixture.get("conditions", []):
		var rt = _make_runtime(fixture)
		var src := String(case.get("src", ""))
		var want = _plain(case.get("expect"))
		var got = rt._eval_condition(src)
		checked += 1
		if not _same(got, want):
			failures.append("条件 `%s` → %s,期望 %s" % [src, str(got), str(want)])


func _run_numbers(fixture: Dictionary) -> void:
	for case in fixture.get("numbers", []):
		var rt = _make_runtime(fixture)
		var src := String(case.get("src", ""))
		var want = _plain(case.get("expect"))
		var got = rt._eval_number(src)
		checked += 1
		if not _same(got, want):
			failures.append("数值 `%s` → %s,期望 %s" % [src, str(got), str(want)])


func _run_instructions(fixture: Dictionary) -> void:
	for case in fixture.get("instructions", []):
		var rt = _make_runtime(fixture)
		var src := String(case.get("src", ""))
		rt._apply_instructions(src)
		for name in case.get("vars", {}):
			var want = _plain(case["vars"][name])
			var got = rt.vars.get(name, null)
			checked += 1
			if not _same(got, want):
				failures.append("指令 `%s` 后 %s = %s,期望 %s" % [src, name, str(got), str(want)])
		for tech in case.get("entityProps", {}):
			for field in case["entityProps"][tech]:
				var want2 = _plain(case["entityProps"][tech][field])
				var props: Dictionary = rt.entity_props.get(tech, {})
				var got2 = props.get(field, null)
				checked += 1
				if not _same(got2, want2):
					failures.append("指令 `%s` 后 %s.%s = %s,期望 %s" % [src, tech, field, str(got2), str(want2)])
