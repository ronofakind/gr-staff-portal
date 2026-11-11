#!/usr/bin/env python3
"""
RBC Express Payroll - Browser Auto-Filler
Pay Period : {{PAY_PERIOD}}
"""
import time
from playwright.sync_api import sync_playwright

PAYROLL = {
    # "AMMAR AL ZIB": 1475.01,
{{PAYROLL_LINES}}
}
PAY_PERIOD = "{{PAY_PERIOD}}"


def get_visible_input(row):
    inp = row.query_selector("input[type='text']")
    if not inp:
        inp = row.query_selector("input:not([type='hidden']):not([type='submit'])"
                                 ":not([type='button']):not([type='checkbox'])")
    return inp


def fill_input_by_mouse(page, inp, amount_str):
    pos = inp.evaluate("""el => {
        el.scrollIntoView({block: 'center', behavior: 'instant'});
        const r = el.getBoundingClientRect();
        return {x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width};
    }""")
    time.sleep(0.25)
    if not pos or pos.get('w', 0) == 0:
        return False
    page.mouse.click(pos['x'], pos['y'], click_count=3)
    time.sleep(0.1)
    page.keyboard.type(amount_str)
    time.sleep(0.1)
    page.keyboard.press("Tab")
    time.sleep(0.1)
    return True


def click_save_and_continue(page):
    pos = page.evaluate("""() => {
        const all = [...document.querySelectorAll('input[type=submit], input[type=button], button')];
        const btn = all.find(b => (b.value || b.textContent || '').toLowerCase().includes('save'));
        if (!btn) return null;
        btn.scrollIntoView({block: 'center', behavior: 'instant'});
        const r = btn.getBoundingClientRect();
        return {x: r.left + r.width/2, y: r.top + r.height/2};
    }""")
    if not pos:
        return False
    time.sleep(0.2)
    page.mouse.click(pos['x'], pos['y'])
    time.sleep(0.8)
    try:
        page.wait_for_load_state("networkidle", timeout=12000)
        page.wait_for_selector("table tr td", timeout=8000)
    except Exception:
        pass
    time.sleep(0.3)
    return True


def fill_page(page, remaining):
    filled_now = []
    try:
        rows = page.query_selector_all("table tr")
    except Exception:
        return filled_now
    for row in rows:
        try:
            cells = row.query_selector_all("td")
            if len(cells) < 3:
                continue
            rbc_name = cells[2].inner_text().strip()
        except Exception:
            continue
        matched = next((k for k in remaining if k.lower() == rbc_name.lower()), None)
        if not matched:
            continue
        inp = get_visible_input(row)
        if not inp:
            print(f"  Warning: no input found for {matched}")
            continue
        if fill_input_by_mouse(page, inp, f"{remaining[matched]:.2f}"):
            filled_now.append((matched, remaining[matched]))
            del remaining[matched]
        else:
            print(f"  Warning: could not fill {matched} (input not visible)")
    return filled_now


def run():
    non_zero = {k: v for k, v in PAYROLL.items() if v > 0}
    print("\n" + "=" * 56)
    print("  RBC Express Payroll - Browser Auto-Filler")
    print(f"  Pay Period : {PAY_PERIOD}")
    print("=" * 56)
    print(f"  Staff to pay : {len(non_zero)}")
    for name, amt in sorted(non_zero.items()):
        print(f"    * {name}  ->  ${amt:,.2f}")
    print(f"  Total        : ${sum(non_zero.values()):,.2f}")
    print("=" * 56 + "\n")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=["--start-maximized"])
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()
        page.goto("about:blank")
        print("  Browser is open!\n")
        print("  1. Go to your RBC Express URL and log in")
        print("  2. Payments, Transfers & Deposits")
        print("  3. ACH Direct Payments & Deposits")
        print("  4. Payment Records -> Global Changes")
        print("  5. Confirm Payment Group = Staff Payroll\n")
        input("  Once you see the payments table, press Enter: ")
        try:
            page.wait_for_selector("table tr td", timeout=15000)
        except Exception:
            print("  Could not find the table. Open Global Changes and try again.")
            input("  Press Enter to close...")
            browser.close()
            return

        remaining, all_filled, page_num = dict(non_zero), [], 1
        print("  Starting...\n")
        while True:
            for name, amt in fill_page(page, remaining):
                print(f"  FILLED  Page {page_num}  |  {name}  ->  ${amt:,.2f}")
                all_filled.append((name, amt))
            if not click_save_and_continue(page):
                print(f"  Could not find Save & Continue on page {page_num}.")
                break
            page_num += 1
            if not remaining:
                print("\n  All amounts filled and saved!")
                break
            if page_num % 10 == 0:
                print(f"  Page {page_num}... ({len(remaining)} left to find)")

        print("\n" + "=" * 56)
        print(f"  Pages visited : {page_num}")
        print(f"  Filled        : {len(all_filled)}  (${sum(a for _, a in all_filled):,.2f})")
        if remaining:
            print(f"  NOT FOUND     : {list(remaining.keys())}")
        print("=" * 56 + "\n")
        input("  Review in RBC, then press Enter to close the browser: ")
        browser.close()


if __name__ == "__main__":
    run()
