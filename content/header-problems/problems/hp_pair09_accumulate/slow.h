// The naive-but-correct reference: it builds a brand new pair out of the two
// component sums and copies that back over *this.
//
// It is CORRECT — it must produce exactly the reference outputs, chained
// expressions included, because it still returns *this — and only too slow.
// That is the point: for a std::string component, `first + other.first`
// allocates and copies the whole accumulated string and `*this = sum` copies
// it a second time, so q accumulations into one pair cost O(q*L) instead of
// O(L). verify.py requires this file to be Accepted on the first six cases
// and to time out on case 7, which proves the large testcases really separate
// an in-place += from one that rebuilds the pair.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
CP::pair<T1, T2> &CP::pair<T1, T2>::operator+=(const CP::pair<T1, T2> &other)
{
  CP::pair<T1, T2> sum(first + other.first, second + other.second);
  *this = sum;
  return *this;
}

template <typename T1, typename T2>
CP::pair<T1, T2> &CP::pair<T1, T2>::absorb_twice(const CP::pair<T1, T2> &other)
{
  *this += other;
  *this += other;
  return *this;
}

#endif
