#!/bin/bash
# Grade all iteration-2 runs programmatically
# Checks each assertion against the generated .ts files

BASE="angular-developer-workspace/iteration-2"

grade_eval1() {
  local dir="$1"
  local card_file=$(find "$dir" -name "card*.component.ts" -o -name "custom-card*.ts" | head -1)
  local header_file=$(find "$dir" -name "*header*.ts" | head -1)
  local all_ts=$(cat "$dir"/*.ts 2>/dev/null)

  local passed=0
  local total=7
  local results=""

  # 1. Uses ng-content with select
  if echo "$all_ts" | grep -q 'ng-content.*select='; then
    passed=$((passed+1)); results+="PASS|"
  else
    results+="FAIL|"
  fi

  # 2. At least 3 ng-content slots
  local slot_count=$(echo "$all_ts" | grep -c '<ng-content')
  if [ "$slot_count" -ge 3 ]; then
    passed=$((passed+1)); results+="PASS|"
  else
    results+="FAIL|"
  fi

  # 3. Fallback content inside ng-content
  if echo "$all_ts" | grep -Pzo '(?s)<ng-content[^/]*>(?!\s*</ng-content).+?</ng-content>' > /dev/null 2>&1; then
    passed=$((passed+1)); results+="PASS|"
  elif echo "$all_ts" | grep -A1 '<ng-content' | grep -v '^--$' | grep -v '/>' | grep -v '</ng-content>' | grep -q '[A-Za-z]'; then
    passed=$((passed+1)); results+="PASS|"
  else
    results+="FAIL|"
  fi

  # 4. Separate CardHeader component
  if [ -n "$header_file" ]; then
    passed=$((passed+1)); results+="PASS|"
  else
    results+="FAIL|"
  fi

  # 5. OnPush
  if echo "$all_ts" | grep -q 'ChangeDetectionStrategy.OnPush'; then
    passed=$((passed+1)); results+="PASS|"
  else
    results+="FAIL|"
  fi

  # 6. No @ContentChild/@ContentChildren decorators
  if ! echo "$all_ts" | grep -q '@ContentChild\|@ContentChildren'; then
    passed=$((passed+1)); results+="PASS|"
  else
    results+="FAIL|"
  fi

  # 7. No explicit standalone: true
  if ! echo "$all_ts" | grep -q 'standalone:\s*true'; then
    passed=$((passed+1)); results+="PASS|"
  else
    results+="FAIL|"
  fi

  echo "$passed/$total|$results"
}

grade_eval2() {
  local dir="$1"
  local tabs_file=$(find "$dir" -name "tabs*.ts" | head -1)
  local tab_item_file=$(find "$dir" -name "tab-item*.ts" -o -name "tab_item*.ts" | head -1)
  local all_ts=$(cat "$dir"/*.ts 2>/dev/null)

  local passed=0
  local total=7
  local results=""

  # 1. viewChildren() function
  if echo "$all_ts" | grep -q 'viewChildren('; then
    passed=$((passed+1)); results+="PASS|"
  else
    results+="FAIL|"
  fi

  # 2. contentChildren() function
  if echo "$all_ts" | grep -q 'contentChildren('; then
    passed=$((passed+1)); results+="PASS|"
  else
    results+="FAIL|"
  fi

  # 3. input() function for label
  if echo "$all_ts" | grep -q 'input\('; then
    passed=$((passed+1)); results+="PASS|"
  elif echo "$all_ts" | grep -q 'input\.required'; then
    passed=$((passed+1)); results+="PASS|"
  else
    results+="FAIL|"
  fi

  # 4. Signal for active tab
  if echo "$all_ts" | grep -q 'signal('; then
    passed=$((passed+1)); results+="PASS|"
  else
    results+="FAIL|"
  fi

  # 5. OnPush on all components
  local component_count=$(echo "$all_ts" | grep -c '@Component')
  local onpush_count=$(echo "$all_ts" | grep -c 'ChangeDetectionStrategy.OnPush')
  if [ "$onpush_count" -ge "$component_count" ] && [ "$component_count" -gt 0 ]; then
    passed=$((passed+1)); results+="PASS|"
  else
    results+="FAIL|"
  fi

  # 6. @for (not *ngFor)
  if echo "$all_ts" | grep -q '@for'; then
    passed=$((passed+1)); results+="PASS|"
  else
    results+="FAIL|"
  fi

  # 7. No decorator imports
  if ! echo "$all_ts" | grep -q 'ViewChildren\|ContentChildren\|ContentChild'; then
    passed=$((passed+1)); results+="PASS|"
  else
    results+="FAIL|"
  fi

  echo "$passed/$total|$results"
}

grade_eval3() {
  local dir="$1"
  local all_ts=$(cat "$dir"/*.ts 2>/dev/null)

  local passed=0
  local total=7
  local results=""

  # 1. viewChild() function
  if echo "$all_ts" | grep -q 'viewChild[.(]'; then
    passed=$((passed+1)); results+="PASS|"
  else
    results+="FAIL|"
  fi

  # 2. Implements interfaces
  if echo "$all_ts" | grep -q 'implements.*OnInit.*AfterViewInit.*OnDestroy\|implements.*OnInit.*OnDestroy.*AfterViewInit\|implements.*AfterViewInit.*OnInit.*OnDestroy\|implements.*AfterViewInit.*OnDestroy.*OnInit\|implements.*OnDestroy.*OnInit.*AfterViewInit\|implements.*OnDestroy.*AfterViewInit.*OnInit'; then
    passed=$((passed+1)); results+="PASS|"
  elif echo "$all_ts" | grep -q 'implements' && echo "$all_ts" | grep -q 'OnInit' && echo "$all_ts" | grep -q 'AfterViewInit' && echo "$all_ts" | grep -q 'OnDestroy'; then
    passed=$((passed+1)); results+="PASS|"
  else
    results+="FAIL|"
  fi

  # 3. ngAfterViewInit measures
  if echo "$all_ts" | grep -q 'ngAfterViewInit'; then
    passed=$((passed+1)); results+="PASS|"
  else
    results+="FAIL|"
  fi

  # 4. Cleanup ResizeObserver
  if echo "$all_ts" | grep -q 'disconnect\|onDestroy.*disconnect\|ResizeObserver.*null'; then
    passed=$((passed+1)); results+="PASS|"
  else
    results+="FAIL|"
  fi

  # 5. OnPush
  if echo "$all_ts" | grep -q 'ChangeDetectionStrategy.OnPush'; then
    passed=$((passed+1)); results+="PASS|"
  else
    results+="FAIL|"
  fi

  # 6. Template ref var or ElementRef read
  if echo "$all_ts" | grep -q "viewChild.*'.*'" || echo "$all_ts" | grep -q 'viewChild.*ElementRef' || echo "$all_ts" | grep -q "viewChild\.required.*'"; then
    passed=$((passed+1)); results+="PASS|"
  else
    results+="FAIL|"
  fi

  # 7. No @ViewChild decorator
  if ! echo "$all_ts" | grep -q '@ViewChild'; then
    passed=$((passed+1)); results+="PASS|"
  else
    results+="FAIL|"
  fi

  echo "$passed/$total|$results"
}

echo "=== EVAL 1: Content Projection Card ==="
for i in $(seq 1 10); do
  dir="$BASE/content-projection-card/with_skill/run-$i/outputs"
  if [ -d "$dir" ] && ls "$dir"/*.ts > /dev/null 2>&1; then
    result=$(grade_eval1 "$dir")
    echo "  Run $i: $result"
  else
    echo "  Run $i: NO OUTPUT"
  fi
done

echo ""
echo "=== EVAL 2: Tabs with Queries ==="
for i in $(seq 1 10); do
  dir="$BASE/tabs-with-queries/with_skill/run-$i/outputs"
  if [ -d "$dir" ] && ls "$dir"/*.ts > /dev/null 2>&1; then
    result=$(grade_eval2 "$dir")
    echo "  Run $i: $result"
  else
    echo "  Run $i: NO OUTPUT"
  fi
done

echo ""
echo "=== EVAL 3: Lifecycle Resize Observer ==="
for i in $(seq 1 10); do
  dir="$BASE/lifecycle-resize-observer/with_skill/run-$i/outputs"
  if [ -d "$dir" ] && ls "$dir"/*.ts > /dev/null 2>&1; then
    result=$(grade_eval3 "$dir")
    echo "  Run $i: $result"
  else
    echo "  Run $i: NO OUTPUT"
  fi
done
