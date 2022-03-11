import random
from math import ceil
from decimal import Decimal
from typing import List
from Crypto.Protocol.SecretSharing import Shamir


FIELD_SIZE = 10**5
 
 
def reconstruct_secret(shares):
    """
    Combines individual shares (points on graph)
    using Lagranges interpolation.
 
    `shares` is a list of points (x, y) belonging to a
    polynomial with a constant of our key.
    """
    sums = 0
    prod_arr = []
 
    for j, share_j in enumerate(shares):
        xj, yj = share_j
        prod = Decimal(1)
 
        for i, share_i in enumerate(shares):
            xi, _ = share_i
            if i != j:
                prod *= Decimal(Decimal(xi)/(xi-xj))
 
        prod *= yj
        sums += Decimal(prod)
 
    return int(round(Decimal(sums), 0))
 
 
def polynom(x, coefficients):
    """
    This generates a single point on the graph of given polynomial
    in `x`. The polynomial is given by the list of `coefficients`.
    """
    point = 0
    # Loop through reversed list, so that indices from enumerate match the
    # actual coefficient indices
    for coefficient_index, coefficient_value in enumerate(coefficients[::-1]):
        point += x ** coefficient_index * coefficient_value
    return point
 
 
def coeff(k, secret) -> List[int]:
    """
    Randomly generate a list of coefficients for a polynomial with
    degree of `k` - 1, whose constant is `secret`.
 
    Args: k (int), secret (int)
    Returns: k-length list, which is coeff of k-1 degree polynomial
    """
    coeff = [random.randrange(0, FIELD_SIZE) for _ in range(k - 1)]
    coeff.append(secret)
    return coeff
 
 
def generate_shares(n, k, secret):
    """
    Split given `secret` into `n` shares with minimum threshold
    of `m` shares to recover this `secret`, using SSS algorithm.
    """
    coefficients = coeff(k, secret)
    shares = []
 
    for _ in range(n):
        x = random.randrange(1, FIELD_SIZE)
        shares.append((x, polynom(x, coefficients)))
 
    return shares
 
 
# Driver code
if __name__ == '__main__':
 
    # (3,4) sharing scheme
    k, n = 3, 4
    secret = 1234
    print(f'Original Secret: {secret}')
 
    shares = generate_shares(n, k, secret)
    print(f'Shares: {", ".join(map(str, shares))}')
 
    pool = random.sample(shares, k)
    print(f'Combining shares: {", ".join(map(str, pool))}')
    print(f'Reconstructed secret: {reconstruct_secret(pool)}')