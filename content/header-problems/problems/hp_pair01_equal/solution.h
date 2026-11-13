// Reference solution: two pairs are equal exactly when both components are.
// Written with the components' own == so it works for every T1/T2 the grader
// instantiates, not only for int.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator==(const CP::pair<T1, T2> &other) const
{
  // Your code here
  return first == other.first && second == other.second;
}

template <typename T1, typename T2>
void CP::pair<T1, T2>::set(const T1 &a, const T2 &b)
{
  // You MAY need to edit this function
  first = a;
  second = b;
}

#endif
