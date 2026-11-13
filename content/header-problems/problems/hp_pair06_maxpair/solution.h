// Reference solution: decide with a lexicographic comparison and then hand
// back ONE OF THE TWO OBJECTS THAT WERE PASSED IN — never a local, never a
// copy. `*this` wins ties, which is what makes dominates() true on both sides
// for two equal pairs.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
const CP::pair<T1, T2> &CP::pair<T1, T2>::larger(const CP::pair<T1, T2> &other) const
{
  // Your code here
  if (first < other.first)
    return other;
  if (other.first < first)
    return *this;
  if (second < other.second)
    return other;
  return *this;
}

template <typename T1, typename T2>
const CP::pair<T1, T2> &CP::pair<T1, T2>::larger3(const CP::pair<T1, T2> &b,
                                                  const CP::pair<T1, T2> &c) const
{
  // You MAY need to edit this function
  return larger(b).larger(c);
}

#endif
