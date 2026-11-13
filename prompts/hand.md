You are simulating a queue by hand, event by event. Work through the customers in order and keep track of when each server becomes free.

The rules:
- There are {servers} identical servers and one queue.
{rules_block}
- A customer's waiting time is (time their service starts) minus (their arrival time). A customer who finds a free server on arrival waits 0.
- Times are in minutes. The system starts empty.

The customers, in arrival order:
{table}

For each customer, answer with exactly one line:
CUSTOMER n WAIT: x.xx      (the waiting time in minutes, 2 decimals)
or, for a customer who gives up and leaves:
CUSTOMER n: ABANDONED
Give the lines in customer order, with nothing else.
