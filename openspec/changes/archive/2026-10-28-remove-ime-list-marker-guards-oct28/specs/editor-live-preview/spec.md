## REMOVED Requirements

### Requirement: IME 组合期不重复插入列表 marker

整条移除。该要求建立在「WebKit smart-list 是重复序号插入者」的未复现推测上；Alex 于 2026-10-28 确认实际来源是旧中文输入法，更换输入法后问题消失。两道输入拦截随之失去需求依据，且 DOM 读回拦截已知会吞掉合法的 marker 形整串输入。正常列表 / 引用续行、裸 marker 行编辑态与空项退出由既有 requirement 继续约束，不在本次删除范围内。
