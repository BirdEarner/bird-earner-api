-- Add 10000 to wallet for dhanshreeshinde276@gmail.com
-- Step 1: Find the user
SELECT u.id, u.email, c.id as client_id, c.wallet, f.id as freelancer_id, f.withdrawable_amount 
FROM users u 
LEFT JOIN clients c ON c.user_id = u.id 
LEFT JOIN freelancers f ON f.user_id = u.id 
WHERE u.email = 'dhanshreeshinde276@gmail.com';

-- Step 2: Update client wallet (if user is a client)
UPDATE clients 
SET wallet = wallet + 10000 
WHERE user_id = (SELECT id FROM users WHERE email = 'dhanshreeshinde276@gmail.com');

-- Step 3: Update freelancer withdrawable amount (if user is a freelancer)
UPDATE freelancers 
SET withdrawable_amount = withdrawable_amount + 10000 
WHERE user_id = (SELECT id FROM users WHERE email = 'dhanshreeshinde276@gmail.com');

-- Step 4: Verify the update
SELECT u.email, c.wallet as client_wallet, f.withdrawable_amount as freelancer_withdrawable
FROM users u 
LEFT JOIN clients c ON c.user_id = u.id 
LEFT JOIN freelancers f ON f.user_id = u.id 
WHERE u.email = 'dhanshreeshinde276@gmail.com';